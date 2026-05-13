upstream vidshort_backend {
    least_conn;
    server 127.0.0.1:4173 max_fails=3 fail_timeout=10s;
    server 127.0.0.1:4174 max_fails=3 fail_timeout=10s;
    keepalive 32;
}

server {
    listen 80;
    listen [::]:80;
    server_name vidshort.uk www.vidshort.uk vidshort.com www.vidshort.com 101.47.12.37 api.vidshort.uk;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name vidshort.uk www.vidshort.uk vidshort.com www.vidshort.com 101.47.12.37 api.vidshort.uk;

    ssl_certificate /etc/letsencrypt/live/vidshort.uk/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vidshort.uk/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    client_max_body_size 2048m;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
    proxy_connect_timeout 30s;
    sendfile on;
    tcp_nopush on;
    keepalive_timeout 65;
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";

    location /media/ {
        proxy_pass http://vidshort_backend;
        proxy_http_version 1.1;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        add_header Accept-Ranges bytes always;
    }

    location ^~ /api/uploads/chunked/ {
        proxy_pass http://vidshort_backend;
        proxy_http_version 1.1;
        proxy_request_buffering off;
        proxy_buffering off;
    }

    location / {
        proxy_pass http://vidshort_backend;
        proxy_http_version 1.1;
    }
}
