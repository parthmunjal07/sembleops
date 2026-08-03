# SembleOps cloud control plane.
# Developer jobs queue for an outbound worker; this container does not mount
# source repositories.

FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts ./
COPY scripts ./scripts
COPY src ./src
COPY ui ./ui
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/dist-ui ./dist-ui
COPY --chown=node:node config/personas.yaml ./config/personas.yaml
COPY --chown=node:node config/sembleops.cloud.yaml ./config/sembleops.yaml
RUN mkdir -p /app/data /projects && chown -R node:node /app/data /projects
VOLUME /app/data
EXPOSE 4747
USER node
CMD ["node", "dist/index.js"]
