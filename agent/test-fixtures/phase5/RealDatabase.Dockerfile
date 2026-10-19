# Opt-in local validation only: no production mount, volume, network or DB.
FROM pluton-ci-validation:phase4
USER root
COPY agent/package.json /app/agent/package.json
RUN apk add --no-cache mariadb mariadb-client postgresql postgresql-client \
 && chown root:root /usr/local/bin/restic /usr/local/bin/rclone
HEALTHCHECK NONE
USER node
ENTRYPOINT ["/app/backend/node_modules/.bin/tsx"]
CMD ["/app/backend/__tests__/integration/phase5Database.smoke.ts"]
