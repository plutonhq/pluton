# Local disposable agent regressions; no source/production mounts.
ARG BASE_IMAGE=pluton-hardening-agent-tests:local
FROM ${BASE_IMAGE}
USER root
COPY agent/test-fixtures/phase5/restic.mjs /opt/pluton-phase5-tools/bin/restic
RUN sed -i 's/\r$//' /opt/pluton-phase5-tools/bin/restic && chmod 0755 /opt/pluton-phase5-tools/bin/restic && chown root:root /opt/pluton-phase5-tools/bin/restic
USER node
ENTRYPOINT ["node", "--test"]
CMD ["/app/agent/dist/*.test.js"]
