# Infrastructure Risk Report: Cloud-Claw Co-location on Production VPS

**Prepared for:** Engineering Management  
**Date:** 2026-04-30  
**Topic:** Proposal to host Cloud-Claw AIOps agent on Cloudstick production VPS using containers

---

## Executive Summary

The proposal to move Cloud-Claw onto the existing Cloudstick production VPS — even inside containers — introduces significant security, reliability, and operational risks that outweigh the potential cost savings. The core problem driving this proposal (network latency between VPCs) has a direct, low-cost fix that does not require restructuring our infrastructure. This document outlines the risks in plain terms and recommends a safer path forward.

---

## What is Cloud-Claw?

Cloud-Claw is an AI-powered server management agent. It:

- Connects to servers over SSH and executes commands
- Holds sensitive credentials (SSH keys, API tokens, webhook secrets)
- Can autonomously fix server problems or hold for human approval
- Communicates with users via Slack and Telegram

Because of what it does and what it holds, **Cloud-Claw must be treated as high-security infrastructure**, not a regular web application.

---

## Risk 1: Container Isolation is Not Absolute

### What management may assume
"Containers keep applications separate — if something goes wrong in one container, others are safe."

### The reality
Containers are **not virtual machines**. They share the same underlying operating system kernel with the host and every other container on the server. This is a fundamental technical distinction with real consequences.

**What this means in practice:**

- A security vulnerability in the Linux kernel (these are discovered regularly) can allow a container to "escape" and take control of the entire host machine
- Well-known examples: CVE-2022-0847 (Dirty Pipe), CVE-2019-5736 — both allowed container escapes on unpatched systems
- A misconfiguration (e.g., running Cloud-Claw with elevated privileges, which is common in agent setups) removes most isolation guarantees

**The risk for us:**  
Cloud-Claw holds SSH credentials for every server it manages. If a container escape occurs, an attacker gains access to those credentials — and through them, to all managed servers. The production VPS becomes the single point through which everything can be compromised.

**Analogy:**  
Containers are like offices in a shared building with a common foundation. A VM is like a separate building. If the foundation is cracked, every office is affected regardless of how solid your office door is.

---

## Risk 2: Memory Pressure Can Take Down Customer Workloads

### Current production VPS load
The Cloudstick production VPS is already running:
- The Cloudstick panel and its database
- Customer application containers
- Nginx / reverse proxy
- Monitoring and logging agents

### What Cloud-Claw adds

| Component | Memory Required |
|---|---|
| Cloud-Claw agent (Node.js + AI context) | 1–4 GB (spikes during active use) |
| Vector database | 1–2 GB |
| Active SSH sessions and tool execution | 200–500 MB |
| **Total addition** | **~4–6 GB, peaks at 8 GB** |

### What happens when memory runs out

When a server runs out of RAM, Linux automatically starts terminating processes to free memory. This is called the OOM (Out of Memory) killer. It does not distinguish between:
- A customer's production application
- The Cloudstick panel itself
- Cloud-Claw in the middle of an operation

**Scenario:** A customer traffic spike at 2am consumes extra RAM. The OOM killer terminates a customer's app container. Simultaneously, Cloud-Claw was mid-way through an SSH command on a server. The command is abandoned halfway — the server is now in an unknown state.

This is not a hypothetical. It is a predictable outcome of overloading a shared server.

---

## Risk 3: Two Unrelated Workloads Fighting Over One Server

Cloud-Claw's resource usage and Cloudstick's resource usage are **completely independent**. They spike at different times for different reasons.

| Situation | Effect |
|---|---|
| Customer traffic spike | Steals RAM/CPU from Cloud-Claw, causing timeouts or slow AI responses |
| Cloud-Claw running intensive diagnosis | Slows down the Cloudstick panel and customer apps |
| Both spike simultaneously | Server becomes unstable, risk of OOM as described above |

On separate servers, each can be scaled independently as needed. Co-located, scaling one always affects the other.

---

## Risk 4: The Actual Cost Saving is Smaller Than Expected

### The assumed saving
"We eliminate one VPS bill by running everything together."

### The actual math

To safely run both workloads on one server, the production VPS would need to be **upsized** to handle the additional 4–8 GB RAM and CPU load. That upgrade cost often matches or exceeds the cost of a separate, right-sized Cloud-Claw VPS.

**Additionally:**

- Cloud-Claw and Cloudstick scale independently. Today Cloud-Claw needs 4 GB. In 6 months, as usage grows, it may need 8 GB. Upsizing the production VPS to accommodate this affects all customers on that server.
- One support incident caused by OOM killing a customer app costs more in staff time and potential SLA credits than months of VPS savings.

**Estimated comparison:**

| Approach | Monthly Cost | Risk Level |
|---|---|---|
| Separate Cloud-Claw VPS (4–8 GB) | $20–40 | Low |
| Upsize production VPS to handle both | $30–60+ increase | High |
| Co-location without upsizing | $0 extra | Very High (OOM risk) |

---

## Risk 5: Compliance and Audit Exposure

If Cloudstick ever pursues SOC 2, ISO 27001, or similar security certifications:

- A management tool with write access to infrastructure **must** be on a separate, auditable boundary from the infrastructure it manages
- Having Cloud-Claw on the same server as customer workloads will be flagged as a critical finding
- Remediating this after an audit is forced upon us is significantly more expensive and disruptive than maintaining proper separation now

---

## The Latency Problem Has a Better Fix

The concern that triggered this proposal — network latency between Cloud-Claw's VPC and the Cloudstick VPC — is a real but easily solved problem.

### Solution: VPC Peering

VPC Peering creates a private, direct network connection between two VPCs. Traffic travels over the cloud provider's internal backbone, not the public internet.

| Property | Value |
|---|---|
| Latency improvement | 5–20ms reduction (private vs. public routing) |
| Cost | Near zero (intra-region peering is free or minimal on most providers) |
| Implementation time | Half a day to one day |
| Security | All traffic stays private, never touches the internet |

This solves the speed concern without touching the production VPS at all.

---

## Recommended Architecture

```
┌──────────────────────────┐    Private VPC Peering    ┌─────────────────────────┐
│   Cloudstick VPC         │◄─────────────────────────►│   Cloud-Claw VPC        │
│                          │      (low latency,         │                         │
│   Production VPS         │       private network)     │   Dedicated VPS         │
│   - Cloudstick panel     │                            │   - Cloud-Claw agent    │
│   - Customer containers  │                            │   - Vector database     │
│   - Panel database       │                            │   - Right-sized RAM     │
└──────────────────────────┘                            └─────────────────────────┘
```

**Benefits of this setup:**
- Latency problem solved via private peering
- Production VPS unaffected by Cloud-Claw load
- Security boundary maintained
- Each service scales independently
- Audit-friendly architecture

---

## Proposed Next Step

1. **Implement VPC peering** between the two VPCs — estimated half a day of work
2. **Measure latency** before and after — gives us data to confirm the speed issue is resolved
3. **Right-size the Cloud-Claw VPS** if cost is genuinely a concern — there may be room to use a smaller instance
4. **Revisit co-location** only if VPC peering fails to meet performance requirements — which is unlikely

This approach is low risk, low cost, and gives us real data to make decisions from.

---

## Summary Table

| Risk | Severity | Likelihood | Fix |
|---|---|---|---|
| Container escape exposes SSH credentials | Critical | Medium | Maintain separate VPS |
| OOM kills customer workloads | High | High under load | Maintain separate VPS |
| Two workloads competing for resources | High | High | Maintain separate VPS |
| Cost saving smaller than expected | Medium | High | Right-size existing VPS |
| Compliance audit finding | Medium | High (if pursuing certs) | Maintain separate VPS |
| Network latency (the original concern) | Low | Current | VPC peering ($0) |

---

*Document prepared by the Cloud-Claw engineering team.*
