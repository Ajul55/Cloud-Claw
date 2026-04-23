# Git Recovery Guide — Office vs Personal Computer

This guide covers how to safely recover when you have work on two computers that haven't been synced.

---

## Step 1 — What You Should Have Done Already (Personal Computer)

Before going to the office, you should have run this on your personal computer:

```bash
git push origin HEAD:backup-personal-2026-04-23
```

This saved your personal work to GitHub under a safe backup branch name. Nothing on the office machine was touched.

---

## Step 2 — At the Office: Check the State First

**Before pulling or doing anything else**, run these two commands:

```bash
git status
git log --oneline -5
```

Look at what comes back. Find your situation in the three outcomes below.

---

## Outcome 1 — Office Work Was Never Committed (Just Saved Files)

**What you see in `git status`:**
```
On branch main
Changes not staged for commit:
  modified:   docker-compose.yml
  modified:   Dockerfile
```

Files are listed under "Changes not staged for commit" or "Untracked files". This means you edited files but never ran `git commit`.

**The risk:** If you pull now, git might overwrite these files.

**How to fix it — step by step:**

```bash
# Step 1: Save your uncommitted office work to a temporary holding area
git stash

# Step 2: Pull the latest from GitHub (your personal work is now on the backup branch)
git pull origin main

# Step 3: Restore your office file changes on top
git stash pop
```

If step 3 shows conflicts (both computers edited the same file), see the **Conflict Resolution** section at the bottom.

```bash
# Step 4: Commit your office work
git add .
git commit -m "feat: containerisation work from office"

# Step 5: Merge in your personal branch work
git merge backup-personal-2026-04-23

# Step 6: Push everything
git push origin main
```

---

## Outcome 2 — Office Work Was Committed But Not Pushed

**What you see in `git log --oneline -5`:**
```
a1b2c3d feat: add docker-compose for all services   ← this commit is ONLY on your office machine
e4f5g6h feat: add gateway health check              ← this is where GitHub stops
...
```

The top commit(s) exist on your machine but not on GitHub. Your work is safe — git tracked it. It just was never uploaded.

**How to fix it — step by step:**

```bash
# Step 1: Fetch what's on GitHub without changing your files
git fetch origin

# Step 2: Merge your personal branch work into the office branch
git merge backup-personal-2026-04-23

# (If there are conflicts, see the Conflict Resolution section below)

# Step 3: Push everything — both the office commits and the personal work
git push origin main
```

This is the safest outcome. Nothing is lost. Git handles it automatically.

---

## Outcome 3 — Office Was Clean (Nothing Was Saved)

**What you see:**
```
On branch main
nothing to commit, working tree clean
```

And `git log` shows the same commits as GitHub — nothing extra on the office machine.

This means the containerisation work was either not started or not saved. It is gone from the office machine.

**How to fix it:**

Your personal computer work is still safe on GitHub under `backup-personal-2026-04-23`.

```bash
# Step 1: Pull that backup branch to your office machine
git fetch origin

# Step 2: Merge it into main
git merge backup-personal-2026-04-23

# Step 3: Push
git push origin main
```

The containerisation work will need to be redone, but at minimum you haven't lost the 2 days of personal work.

---

## Conflict Resolution (When Two Files Were Edited in Both Places)

If git says something like:
```
CONFLICT (content): Merge conflict in src/interfaces/http_gateway.ts
Automatic merge failed; fix conflicts then commit the result.
```

Open that file. You will see something like this inside it:

```
<<<<<<< HEAD
// This is the office version of the code
const port = 8080;
=======
// This is the personal computer version of the code
const port = 9000;
>>>>>>> backup-personal-2026-04-23
```

**What to do:**
1. Delete the `<<<<<<< HEAD`, `=======`, and `>>>>>>> backup-personal-2026-04-23` lines
2. Keep whichever version (or both combined) is correct
3. Save the file
4. Then run:

```bash
git add <filename>
git commit -m "merge: resolve conflict between office and personal work"
```

---

## Understanding Branches (Simple Explanation)

If you have only ever worked on `main`, think of branches this way:

- **`main`** is your main road. Everyone drives on it.
- **A branch** is a side road that splits off from the main road. Changes on the side road do not affect the main road until you merge them back in.
- **`backup-personal-2026-04-23`** is a side road we created to park your personal work safely. Nobody can crash into it.
- **Merging** is the act of bringing the side road back into the main road — taking all the changes from the branch and adding them to main.

```
main:    A --- B --- C (office commit) --- merge point
                \                        /
personal:        D --- E --- F ----------
```

When you run `git merge backup-personal-2026-04-23`, git takes commits D, E, F and adds them onto main automatically.

---

## Quick Reference — Commands You Will Use

| Command | What it does |
|---|---|
| `git status` | Shows what files have changed and whether they are committed |
| `git log --oneline -5` | Shows the last 5 commits |
| `git stash` | Temporarily saves uncommitted changes so you can pull safely |
| `git stash pop` | Brings back the changes you stashed |
| `git fetch origin` | Downloads latest from GitHub without changing your files |
| `git merge <branch>` | Brings another branch's work into your current branch |
| `git push origin main` | Uploads your commits to GitHub |
| `git branch -a` | Lists all branches (local and on GitHub) |

---

## The Branch We Created for Your Personal Work

Branch name on GitHub: **`backup-personal-2026-04-23`**

To see it on GitHub, go to your repository → click the branch dropdown → you should see it listed there.

To delete it after everything is merged and safe:

```bash
git push origin --delete backup-personal-2026-04-23
```

Only delete it after you have confirmed everything merged correctly into main.
