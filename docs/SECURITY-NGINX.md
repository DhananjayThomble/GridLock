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
