# 自動デプロイ

`main` に push すると、GitHub Actions が rsync でさくらVPS（nginx、`/var/www/wasowaso.com/html`）に配置する。

| リポジトリ | 配置先 |
|---|---|
| wscalm/html | `/var/www/wasowaso.com/html` |
| wscalm/booklog | `/var/www/wasowaso.com/html/booklog` |
| wscalm/romberg-web | `/var/www/wasowaso.com/html/romberg` |
| wscalm/generate-100masu | `/var/www/wasowaso.com/html/generate-100masu` |

- 処理の本体は `html` の `.github/workflows/rsync-deploy.yml`。各リポジトリの `.github/workflows/deploy.yml` はそれを呼ぶだけで、中身はどれも同じ（`html` だけ参照先がローカルパス）。
- 配置先はサーバーの `authorized_keys` で鍵ごとに固定する。ワークフロー側では指定しない。
- 公開しないファイルは各リポジトリの `.deployignore` に書く。
- `html` の `.deployignore` にはサブプロジェクトのディレクトリを書いておく。書かないと `--delete` で消える。新しいサブプロジェクトを足したら、ここにも1行足す。

## 初回セットアップ

### 1. デプロイ用の鍵を作る（ローカル）

```bash
for r in html booklog romberg-web generate-100masu; do
  ssh-keygen -t ed25519 -N "" -C "deploy-$r" -f ~/.ssh/deploy-$r
done
```

### 2. サーバーの準備（VPS で実行）

```bash
# デプロイ専用ユーザー（sudo なし）
sudo adduser --disabled-password --gecos "" deploy
sudo install -d -o deploy -g deploy -m 700 /home/deploy/.ssh

# 配置先ディレクトリを用意し、deploy の持ち物にする
sudo install -d /var/www/wasowaso.com/html/booklog /var/www/wasowaso.com/html/romberg /var/www/wasowaso.com/html/generate-100masu
sudo chown -R deploy:deploy /var/www/wasowaso.com/html

# rrsync があるか（Ubuntu 24.04 は rsync パッケージに同梱）
command -v rrsync
```

`/home/deploy/.ssh/authorized_keys`（所有者 deploy、パーミッション 600）に、手順1で作った公開鍵（`~/.ssh/deploy-*.pub`）を1行ずつ書く。

```
command="rrsync /var/www/wasowaso.com/html",restrict ssh-ed25519 AAAA... deploy-html
command="rrsync /var/www/wasowaso.com/html/booklog",restrict ssh-ed25519 AAAA... deploy-booklog
command="rrsync /var/www/wasowaso.com/html/romberg",restrict ssh-ed25519 AAAA... deploy-romberg-web
command="rrsync /var/www/wasowaso.com/html/generate-100masu",restrict ssh-ed25519 AAAA... deploy-generate-100masu
```

`/etc/ssh/sshd_config` で `AllowUsers` を使っている場合は `deploy` を追加して、sshd をリロードする。

nginx の `server` ブロックに、ドットで始まるファイル（`.git` など）を拒否する設定を足す。

```nginx
location ~ /\.(?!well-known) { deny all; }
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

さくらのパケットフィルターと ufw で、SSH のポートを全ての接続元から受け付けているか確認する（GitHub Actions は海外のIPから接続する）。

### 3. Secrets の登録（ローカル）

```bash
HOST=サーバーのホスト名
PORT=22
for r in html booklog romberg-web generate-100masu; do
  gh secret set SSH_KEY  -R wscalm/$r < ~/.ssh/deploy-$r
  gh secret set SSH_HOST -R wscalm/$r -b "$HOST"
  gh secret set SSH_PORT -R wscalm/$r -b "$PORT"
  gh secret set SSH_USER -R wscalm/$r -b deploy
  ssh-keyscan -p "$PORT" "$HOST" 2>/dev/null | gh secret set KNOWN_HOSTS -R wscalm/$r
done
```

登録が済んだら、ローカルの秘密鍵 `~/.ssh/deploy-*` は消してよい（作り直せる）。

### 4. dry-run で確認してから有効にする

1. 各リポジトリの Actions → deploy → Run workflow（dry-run にチェックが入った状態）で実行する。
2. ログの rsync の出力を確認する。`*deleting` の行は、本番から消えるファイル。消えて困るものがあれば `.deployignore` に足す。
3. dry-run のチェックを外して実行し、本番に反映する。
4. push で自動デプロイされるようにする。

   ```bash
   for r in html booklog romberg-web generate-100masu; do
     gh variable set DEPLOY_ENABLED -R wscalm/$r -b true
   done
   ```

### 5. 後片付け（VPS で実行）

以前の `git pull` で置かれたものは、除外対象なので rsync では消えない。手で消す。

```bash
cd /var/www/wasowaso.com/html
sudo rm -rf .git README.md \
  booklog/.gitignore booklog/*.py booklog/*.csv booklog/TLdata.txt \
  booklog/googlebooks booklog/openbd booklog/data/enrich.json \
  generate-100masu/instruction.md
```

## 止めたいとき

```bash
gh variable set DEPLOY_ENABLED -R wscalm/<リポジトリ> -b false
```
