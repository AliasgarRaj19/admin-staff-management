FROM node:20-alpine AS build

WORKDIR /app

ARG VITE_API_URL=/admin-staff/api
ARG VITE_APP_BASE_PATH=/admin-staff
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_APP_BASE_PATH=$VITE_APP_BASE_PATH

COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json

RUN npm ci

COPY . .

RUN npm run build -w client

FROM nginx:1.27-alpine AS runtime

COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html/admin-staff

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
