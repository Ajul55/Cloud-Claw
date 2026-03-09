import { sshExec } from '../utils/ssh.js';
import type { Tool, ToolResult } from './types.js';

export const create_nginx_vhost: Tool = {
  name: 'create_nginx_vhost',
  description:
    'Create a new Nginx virtual host config on the server. ' +
    'Use this when the user wants to: add a new site, set up a reverse proxy, ' +
    'point a domain to an IP/port, or create a new vhost. ' +
    'Requires: host, domain, and one of: static_root (for static sites) ' +
    'or proxy_pass (for reverse proxy e.g. "http://65.20.82.177/api"). ' +
    'This tool will trigger approval before writing.',
  parameters: {
    type: 'object',
    properties: {
      host: {
        type: 'string',
        description: 'IP of the server to configure',
      },
      domain: {
        type: 'string',
        description: 'Domain name e.g. ajul.sreekutty.site',
      },
      proxy_pass: {
        type: 'string',
        description: 'Backend URL for reverse proxy e.g. http://65.20.82.177/api',
      },
      static_root: {
        type: 'string',
        description: 'File system path for static site e.g. /var/www/mysite',
      },
      enable_ssl: {
        type: 'boolean',
        description: 'Whether to add SSL config (default false)',
      },
    },
    required: ['host', 'domain'],
  },

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const host = String(args.host ?? '');
    const domain = String(args.domain ?? '');
    const proxyPass = args.proxy_pass ? String(args.proxy_pass) : null;
    const staticRoot = args.static_root ? String(args.static_root) : null;

    if (!host || !domain) {
      return { success: false, output: 'Error: host and domain are required' };
    }
    if (!proxyPass && !staticRoot) {
      return {
        success: false,
        output: 'Error: either proxy_pass or static_root is required. ' +
          'proxy_pass example: http://65.20.82.177/api — ' +
          'static_root example: /var/www/mysite',
      };
    }

    try {
      // Build the vhost config content
      let configContent: string;

      if (proxyPass) {
        configContent = [
          'server {',
          '    listen 80;',
          `    server_name ${domain};`,
          '',
          '    location / {',
          `        proxy_pass ${proxyPass};`,
          '        proxy_set_header Host $host;',
          '        proxy_set_header X-Real-IP $remote_addr;',
          '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
          '        proxy_set_header X-Forwarded-Proto $scheme;',
          '        proxy_connect_timeout 60s;',
          '        proxy_read_timeout 60s;',
          '    }',
          '}',
        ].join('\n');
      } else {
        configContent = [
          'server {',
          '    listen 80;',
          `    server_name ${domain};`,
          `    root ${staticRoot};`,
          '    index index.html index.php;',
          '',
          '    location / {',
          '        try_files $uri $uri/ =404;',
          '    }',
          '}',
        ].join('\n');
      }

      // Determine config file path
      const configPath = `/etc/nginx/sites-enabled/${domain}.conf`;

      // Check if file already exists
      const existsCheck = await sshExec(host,
        `test -f ${configPath} && echo EXISTS || echo NOTFOUND`
      );
      if (existsCheck.includes('EXISTS')) {
        return {
          success: false,
          output: `Config file ${configPath} already exists. ` +
            `Use fix_nginx_config to edit it instead.`,
        };
      }

      // Write via base64 to avoid literal \n bug
      const encoded = Buffer.from(configContent, 'utf8').toString('base64');
      await sshExec(host,
        `echo '${encoded}' | base64 -d | tee ${configPath} > /dev/null`
      );

      // Verify file was written correctly
      const preview = await sshExec(host, `head -5 ${configPath}`);
      if (preview.includes('\\n')) {
        return {
          success: false,
          output: `File write failed — literal \\n detected in ${configPath}`,
        };
      }

      // Test nginx config
      const testResult = await sshExec(host, 'nginx -t 2>&1');
      if (!testResult.includes('test is successful') && !testResult.includes('syntax is ok')) {
        // Config test failed — remove the bad file
        await sshExec(host, `rm ${configPath}`);
        return {
          success: false,
          output: `Config test failed after writing. File removed.\nnginx -t output:\n${testResult}`,
        };
      }

      // Reload nginx
      await sshExec(host, 'systemctl reload nginx');

      return {
        success: true,
        output:
          `✅ Vhost created: ${configPath}\n` +
          `Domain: ${domain}\n` +
          `${proxyPass ? `Proxy: ${proxyPass}` : `Root: ${staticRoot}`}\n` +
          `nginx -t: ${testResult.trim()}\n` +
          `nginx reloaded successfully.`,
      };

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: `Error: ${msg}` };
    }
  },
};
