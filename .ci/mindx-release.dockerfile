FROM mirrors.tencent.com/docs-oci/docs-oci-dev-node20-pnpm9

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3-venv \
  && python3 -m venv /opt/coscmd \
  && /opt/coscmd/bin/pip install --no-cache-dir coscmd \
  && command -v curl >/dev/null \
  && command -v git >/dev/null \
  && rm -rf /var/lib/apt/lists/*

ENV PATH="/opt/coscmd/bin:${PATH}"
