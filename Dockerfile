# Dockerfile for Loop.
FROM node:16-alpine as build
WORKDIR /opt/app/

# Add package.json and run `npm install` first, to generate a cached layer for faster local builds.
ADD package.json package-lock.json /opt/app/
RUN npm install -g npm && \
    npm ci && \
    rm -rf ~/.npm ~/.cache
ADD . /opt/app/
RUN npm run build

# `releaseIntermediate` image is an intermediate image where we do our build release.
FROM build as releaseIntermediate
# Delete npm devDepenedencies.
RUN npm prune --production
# Delete source code and tests and other stuff we don't need.
RUN rm -rf src test

# This is the final release image.  It's created from `base` so it has none of
# the dev dependencies at the OS level, and then we copy the app from `releaseIntermediate`
# so we have none of the dev dependencies from NPM either.
FROM node:16-alpine as release
WORKDIR /opt/app/

RUN apk --no-cache add tini
COPY --from=releaseIntermediate /opt/app/ /opt/app/

USER node
EXPOSE 80
ENTRYPOINT [ "tini", "--", "node", "./bin/kube-auth-proxy"]
