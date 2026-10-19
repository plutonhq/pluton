# Local-only operator/test driver. Never part of the application or its Compose.
FROM docker:28.5.1-cli@sha256:a35dae37a79d2b84ccf0100045aec5ab920e4cc8e84f9141d355da602f8af899
RUN apk add --no-cache python3 openssl
ENV PYTHONDONTWRITEBYTECODE=1
ENTRYPOINT ["python3"]
