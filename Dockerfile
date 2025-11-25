# 軽量な nginx イメージをベースにする
FROM nginx:alpine

# 作業ディレクトリ（任意）
WORKDIR /usr/share/nginx/html

# 既存のファイルを一旦消しておく（デフォルトindex.htmlを消す）
RUN rm -rf ./*

# ローカルの index.html をコンテナ内にコピー
COPY index.html /usr/share/nginx/html/index.html

# ポート80を公開
EXPOSE 80

# nginx をフォアグラウンドで起動
CMD ["nginx", "-g", "daemon off;"]