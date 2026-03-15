# Nginx Security Hardening

## server_tokens off

Uncomment `server_tokens off;` in `/etc/nginx/nginx.conf` to hide Nginx version from response headers.

This prevents the `Server: nginx/x.x.x` header from being sent, reducing information disclosure.

## /metrics restriction

Add IP restriction to the `/metrics` location in the API Nginx config to ensure only localhost can reach it:

```nginx
location /metrics {
    allow 127.0.0.1;
    allow ::1;
    deny all;
    proxy_pass http://127.0.0.1:5000/metrics;
}
```

This provides defense-in-depth alongside the application-level IP check in `server.js`.

## Cloudflare `set_real_ip_from`

If your server sits behind Cloudflare, Nginx will see Cloudflare's edge IP as `$remote_addr` instead of the visitor's real IP. Use `set_real_ip_from` with Cloudflare's IP ranges and `real_ip_header CF-Connecting-IP` to restore the correct client IP:

```nginx
# Cloudflare IPv4 ranges — keep updated via https://www.cloudflare.com/ips-v4
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;
set_real_ip_from 103.31.4.0/22;
set_real_ip_from 141.101.64.0/18;
set_real_ip_from 108.162.192.0/18;
set_real_ip_from 190.93.240.0/20;
set_real_ip_from 188.114.96.0/20;
set_real_ip_from 197.234.240.0/22;
set_real_ip_from 198.41.128.0/17;
set_real_ip_from 162.158.0.0/15;
set_real_ip_from 104.16.0.0/13;
set_real_ip_from 104.24.0.0/14;
set_real_ip_from 172.64.0.0/13;
set_real_ip_from 131.0.72.0/22;

real_ip_header CF-Connecting-IP;
```

Without this, `X-Real-IP` will contain Cloudflare's IP, making both the application-level `/metrics` IP check and per-IP rate limiting ineffective.
