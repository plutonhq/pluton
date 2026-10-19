ARG BASE_IMAGE=node:24-bookworm-slim
FROM ${BASE_IMAGE}
USER root
COPY agent/test-fixtures/phase5 /opt/pluton-phase5-fixtures
RUN mkdir -p /opt/pluton-phase5-tools/bin /opt/pluton-phase5-tools/hooks /opt/pluton-phase5-tools/mysql-only /usr/lib/postgresql/17/bin \
 && cp /opt/pluton-phase5-fixtures/database-client.mjs /opt/pluton-phase5-tools/bin/mysqldump \
 && cp /opt/pluton-phase5-fixtures/database-client.mjs /opt/pluton-phase5-tools/bin/mariadb-dump \
 && cp /opt/pluton-phase5-fixtures/database-client.mjs /opt/pluton-phase5-tools/bin/pg_dump \
 && cp /opt/pluton-phase5-fixtures/database-client.mjs /usr/lib/postgresql/17/bin/pg_dump \
 && cp /opt/pluton-phase5-fixtures/database-client.mjs /opt/pluton-phase5-tools/mysql-only/mariadb-dump \
 && cp /opt/pluton-phase5-fixtures/restic.mjs /opt/pluton-phase5-tools/bin/restic \
 && cp /opt/pluton-phase5-fixtures/rclone.mjs /opt/pluton-phase5-tools/bin/rclone \
 && for name in prepare cleanup fail slow noisy dirty child not-executable writable setuid; do cp /opt/pluton-phase5-fixtures/hook.mjs /opt/pluton-phase5-tools/hooks/$name; done \
 && sed -i 's/\r$//' /opt/pluton-phase5-tools/bin/* /opt/pluton-phase5-tools/hooks/* /opt/pluton-phase5-tools/mysql-only/* /usr/lib/postgresql/17/bin/pg_dump \
 && chmod 0755 /opt/pluton-phase5-tools /opt/pluton-phase5-tools/bin /opt/pluton-phase5-tools/hooks /opt/pluton-phase5-tools/bin/* /opt/pluton-phase5-tools/hooks/* \
 && chmod 0755 /opt/pluton-phase5-tools/mysql-only /opt/pluton-phase5-tools/mysql-only/* \
 && chmod 0755 /usr/lib/postgresql /usr/lib/postgresql/17 /usr/lib/postgresql/17/bin /usr/lib/postgresql/17/bin/pg_dump \
 && chown -R root:root /usr/lib/postgresql/17 \
 && chmod 0644 /opt/pluton-phase5-tools/hooks/not-executable \
 && chmod 0775 /opt/pluton-phase5-tools/hooks/writable \
 && ln -s /opt/pluton-phase5-tools/hooks/prepare /opt/pluton-phase5-tools/hooks/link \
 && chown -R root:root /opt/pluton-phase5-tools \
 && chmod 4755 /opt/pluton-phase5-tools/hooks/setuid
ENV PLUTON_PHASE5_TEST_TOOLS=/opt/pluton-phase5-tools
USER node
HEALTHCHECK NONE
ENTRYPOINT ["node", "--test"]
CMD ["/app/agent/dist/backupLifecycle.test.js"]
