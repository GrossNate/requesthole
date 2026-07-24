# syntax=docker/dockerfile:1

# --- Build stage: produce the static prod bundle (BASE_URL="") ---
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Serve stage: Nginx serves static assets + reverse-proxies to backend ---
FROM nginx:alpine AS serve
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
