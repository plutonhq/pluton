# Local-only real SFTP/Restic/MariaDB and root-owned bounded fault injection.
FROM pluton-phase5-real-db:local
USER root
RUN mkdir -p /opt/pluton-parent-tools/bin && ln -s /usr/local/bin/rclone /opt/pluton-parent-tools/bin/rclone
COPY agent/test-fixtures/phase5/parent-restic.mjs /opt/pluton-parent-tools/bin/restic
RUN sed -i 's/\r$//' /opt/pluton-parent-tools/bin/restic && chmod 0755 /opt/pluton-parent-tools/bin/restic && chown root:root /opt/pluton-parent-tools/bin/restic
USER node
