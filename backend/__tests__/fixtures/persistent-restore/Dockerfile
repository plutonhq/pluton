# Disposable local operator fixture ONLY; never part of the application/worker image.
ARG RUNTIME_IMAGE=pluton-persistent-ci:local
FROM ${RUNTIME_IMAGE}
USER root
RUN apk add --no-cache util-linux e2fsprogs e2fsprogs-extra bash shadow diffutils openssl \
      'mariadb>=11.8.8-r0' 'postgresql18>=18.6-r0' \
 && (getent group 999 >/dev/null || addgroup -g 999 fixture-db) \
 && usermod -u 999 -g 999 postgres \
 && test "$(id -u pluton)" = 10001 \
 && mkdir -p /fixture/state /var/lib/pluton-persistent-restores /etc/pluton-persistent-restores /var/lib/mysql /var/lib/postgresql \
 && ln -sf /sbin/losetup /usr/sbin/losetup \
 && ln -sf /sbin/mkfs.ext4 /usr/sbin/mkfs.ext4 \
 && ln -sf /sbin/blkid /usr/sbin/blkid
RUN ln -sf /bin/mount /usr/bin/mount && ln -sf /bin/umount /usr/bin/umount \
 && ln -sf /bin/findmnt /usr/bin/findmnt
COPY deploy/persistent-restore/storage.cjs /fixture/storage.cjs
COPY deploy/persistent-restore/operator.cjs /fixture/operator.cjs
COPY deploy/persistent-restore/bootstrap.sh /fixture/bootstrap.sh
COPY backend/__tests__/integration/persistentStorage.smoke.cjs /fixture/quota-smoke.cjs
COPY backend/__tests__/integration/persistentNative.smoke.cjs /fixture/native-smoke.cjs
COPY backend/__tests__/integration/persistentNative.app.mjs /fixture/native-app.mjs
HEALTHCHECK NONE
ENTRYPOINT ["node","/fixture/quota-smoke.cjs"]
