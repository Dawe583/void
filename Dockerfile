FROM node:24-slim
LABEL org.opencontainers.image.source="https://github.com/Dawe583/void"
WORKDIR /void
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/cli/package.json packages/cli/package.json
COPY packages/connectors/package.json packages/connectors/package.json
COPY packages/ledger/package.json packages/ledger/package.json
COPY packages/policy/package.json packages/policy/package.json
COPY packages/proxy/package.json packages/proxy/package.json
COPY packages/registry/package.json packages/registry/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY scripts/package.json scripts/package.json
RUN pnpm install --frozen-lockfile
COPY . .
CMD ["node", "packages/cli/bin/void.mjs", "--help"]
