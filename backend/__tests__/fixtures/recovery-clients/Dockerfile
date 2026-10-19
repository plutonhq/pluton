# Disposable DATABASE SERVER fixture only; never publish/deploy as the Pluton image.
FROM node:24.16.0-alpine
USER root
RUN apk add --no-cache 'mariadb>=11.8.8-r0' 'mariadb-client>=11.8.8-r0' 'postgresql18>=18.6-r0' 'postgresql18-client>=18.6-r0' \
 && addgroup -S -g 10001 fixture-shared \
 && install -d -o 1000 -g 10001 -m 0750 /fixture-control
USER 1000:10001
ENTRYPOINT ["node", "/fixture-server.mjs"]
