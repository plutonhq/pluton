# Local CI orchestration only, never a Pluton runtime/worker image or Compose service.
# Both descriptors are the reviewed official linux/amd64 images.
FROM docker:28.5.1-cli@sha256:a35dae37a79d2b84ccf0100045aec5ab920e4cc8e84f9141d355da602f8af899 AS cli
FROM mcr.microsoft.com/powershell:7.5-ubuntu-24.04@sha256:042240d57ec9e47e511033b92625a8d95875ee5860af3015992c248b58a8be81
COPY --from=cli /usr/local/bin/docker /usr/local/bin/docker
RUN docker --version && pwsh -NoLogo -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'
ENTRYPOINT ["pwsh", "-NoLogo", "-NoProfile"]
