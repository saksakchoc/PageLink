FROM nginx:alpine

WORKDIR /usr/share/nginx/html
RUN rm -rf ./*

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
COPY main.js   /usr/share/nginx/html/main.js

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
