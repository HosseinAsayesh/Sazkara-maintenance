<div dir="rtl">

# نگهداری سازکارا — راهنمای نصب ({{VERSION}})

برای Ubuntu Server 24.04 LTS (نسخه‌ی 22.04 هم کار می‌کند). همه‌ی دستورها روی سرور و
با کاربری که دسترسی `sudo` دارد اجرا می‌شوند. نسخه‌ی انگلیسی: `INSTALL.md`

**محل هر چیز پس از نصب**

| مسیر | محتوا |
|---|---|
| `/opt/sazkara/app` | خود برنامه (در هر به‌روزرسانی جایگزین می‌شود) |
| `/opt/sazkara/tools` | اسکریپت‌های migrate / seed / backup / restore |
| `/etc/sazkara/sazkara.env` | تنظیمات و رمزها (رمز پایگاه داده و…) |
| `/var/lib/sazkara/uploads` | عکس‌ها، امضاها، فایل‌های واردشده، PDFها — **حتماً پشتیبان بگیرید** |
| پایگاه داده‌ی PostgreSQL با نام `sazkara` | همه‌ی رکوردها — **حتماً پشتیبان بگیرید** |
| `/var/backups/sazkara` | پشتیبان‌های روزانه |

---

## ۱. سرور

- پیشنهادی: ۴ هسته، ۸ گیگابایت رم، ۱۰۰ گیگابایت SSD. حداقل: ۲ هسته، ۴ گیگابایت رم،
  ۶۰ گیگابایت. (ساخت PDF یک مرورگر بدون رابط اجرا می‌کند و به حافظه نیاز دارد.)
- یک نام دامنه (مثلاً `maintenance.example.ir`) که رکورد A آن به سرور اشاره کند،
  برای HTTPS.
- فایل `{{SERVER_TAR}}` را در پوشه‌ی خانگی سرور بارگذاری کنید (مثلاً با `scp` یا
  WinSCP).

## ۲. بسته‌های سیستمی

</div>

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y postgresql nginx certbot python3-certbot-nginx \
  fonts-vazirmatn fonts-noto-core curl ca-certificates openssl
```

<div dir="rtl">

دو بسته‌ی فونت برای نمایش درست متن فارسی در گزارش‌های PDF لازم‌اند.

**Node.js** (نسخه‌ی 20.9 یا بالاتر؛ پیشنهاد: 22 LTS):

</div>

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version
```

<div dir="rtl">

اگر این سایت از روی سرور در دسترس نیست، Node.js 22 را از فایل رسمی Linux x64
(سایت nodejs.org یا یک میرور داخلی) نصب کنید و مطمئن شوید `/usr/bin/node` وجود
دارد (اگر در `/usr/local` نصب شد: `sudo ln -s /usr/local/bin/node /usr/bin/node`).

**Chrome یا Chromium** (برای گزارش‌های PDF). گزینه‌ی الف ترجیح دارد:

- الف) Google Chrome: فایل `google-chrome-stable_current_amd64.deb` را دریافت کنید (از
  `dl.google.com/linux/direct/`، یا اگر سرورهای گوگل در دسترس نیستند روی رایانه‌ی
  دیگری دریافت و روی سرور بارگذاری کنید) و سپس
  `sudo apt install -y ./google-chrome-stable_current_amd64.deb`.
  مسیر: `/usr/bin/google-chrome`
- ب) `sudo snap install chromium`. مسیر: `/snap/bin/chromium`

## ۳. کاربر و پوشه‌ها

</div>

```bash
sudo useradd --system --home /opt/sazkara --shell /usr/sbin/nologin sazkara
sudo mkdir -p /opt/sazkara /etc/sazkara /var/lib/sazkara/uploads /var/backups/sazkara
sudo tar -xzf ~/{{SERVER_TAR}} -C /opt/sazkara
sudo chmod +x /opt/sazkara/tools/*.sh
sudo chown -R sazkara:sazkara /opt/sazkara/app /var/lib/sazkara
```

<div dir="rtl">

## ۴. پایگاه داده

</div>

```bash
DB_PASSWORD=$(openssl rand -hex 24)
echo "$DB_PASSWORD"      # copy this; it goes into the settings file in step 5
sudo -u postgres psql -c "CREATE USER sazkara WITH PASSWORD '$DB_PASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE sazkara OWNER sazkara ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0;"
```

<div dir="rtl">

رمزی را که چاپ می‌شود یادداشت کنید؛ در گام ۵ لازم است. PostgreSQL به‌طور پیش‌فرض
فقط روی خود سرور در دسترس است؛ همین‌طور بماند.

## ۵. تنظیمات

</div>

```bash
sudo install -o root -g sazkara -m 640 /opt/sazkara/config/sazkara.env.example /etc/sazkara/sazkara.env
openssl rand -hex 32     # copy this for AUTH_SECRET
sudo nano /etc/sazkara/sazkara.env
```

<div dir="rtl">

همه‌ی `CHANGE_ME`ها را جایگزین کنید:

- `DATABASE_URL`: رمز پایگاه داده از گام ۴ را به‌جای `CHANGE_ME_DB_PASSWORD` بگذارید
- `AUTH_SECRET`: خروجی دستور `openssl rand -hex 32`
- `CHROME_PATH`: مسیر مرورگر از گام ۲
- `SEED_MANAGER_PHONE` / `SEED_MANAGER_PASSWORD`: شماره و رمز نخستین حساب مدیر
- `SEED_CLIENT_PASSWORD`: اختیاری؛ حساب ناظر جی‌تی‌آی را می‌سازد

## ۶. جدول‌ها و داده‌های اولیه

**نصب تازه** (سامانه‌ی خالی):

</div>

```bash
sudo /opt/sazkara/tools/migrate.sh
sudo /opt/sazkara/tools/seed.sh
```

<div dir="rtl">

**انتقال داده‌های فعلی نسخه‌ی آزمایشی به‌جای آن**: توسعه‌دهنده یک پوشه‌ی پشتیبان
(`database.sql` و `uploads/`) تحویل می‌دهد. آن را بارگذاری کنید، گام‌های ۷ و ۸ را انجام
دهید و به‌جای اجرای `seed.sh`، بخش «بازیابی» در گام ۱۱ را دنبال کنید.

## ۷. راه‌اندازی برنامه

</div>

```bash
sudo cp /opt/sazkara/config/sazkara.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sazkara
sudo systemctl status sazkara           # should say "active (running)"
curl -I http://127.0.0.1:3000/fa/login  # should answer "HTTP/1.1 200"
```

<div dir="rtl">

گزارش‌ها (لاگ): `sudo journalctl -u sazkara -f`

## ۸. Nginx و HTTPS

</div>

```bash
sudo cp /opt/sazkara/config/nginx-sazkara.conf /etc/nginx/sites-available/sazkara
sudo sed -i 's/YOUR_DOMAIN/maintenance.example.ir/' /etc/nginx/sites-available/sazkara   # your domain
sudo ln -s /etc/nginx/sites-available/sazkara /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d maintenance.example.ir                                           # your domain
```

<div dir="rtl">

به‌جای `maintenance.example.ir` دامنه‌ی خودتان را بنویسید.

## ۹. دیوار آتش

</div>

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

<div dir="rtl">

فقط SSH، HTTP و HTTPS باز هستند. خود برنامه (پورت 3000) و PostgreSQL (پورت 5432) از
بیرون در دسترس نیستند.

## ۱۰. مجوز استفاده

تا وقتی مجوزی نصب نشده، برنامه **فقط‌خواندنی** است و پیام قرمز نشان می‌دهد. برای نصب:

1. توسعه‌دهنده متن مجوز را می‌فرستد (متنی که با
   `-----BEGIN SAZKARA LICENSE-----` شروع می‌شود).
2. با حساب مدیر وارد شوید ← **تنظیمات** ← کارت **مجوز استفاده** در پایین صفحه.
3. کل متن را وارد کنید ← **نصب مجوز**.

مدیران ۱۴ روز پیش از پایان مجوز پیام زرد می‌بینند. پس از پایان مجوز، برنامه دوباره
فقط‌خواندنی می‌شود: هیچ چیز حذف نمی‌شود، همه‌چیز قابل مشاهده و خروجی‌گرفتن می‌ماند و
به محض نصب مجوز جدید، برنامه به حالت عادی برمی‌گردد.

## ۱۱. پشتیبان‌گیری

**پشتیبان خودکار روزانه** ساعت ۰۲:۳۰ (پشتیبان‌های ۱۴ روز اخیر نگه داشته می‌شوند):

</div>

```bash
echo '30 2 * * * root /opt/sazkara/tools/backup.sh >> /var/log/sazkara-backup.log 2>&1' | sudo tee /etc/cron.d/sazkara-backup
sudo /opt/sazkara/tools/backup.sh      # run one now to check it works
```

<div dir="rtl">

هر پشتیبان یک پوشه‌ی `/var/backups/sazkara/<تاریخ-ساعت>/` شامل `database.sql` و
`uploads/` است. **این پوشه‌ها را مرتب به بیرون از سرور کپی کنید** (سرور دیگر، NAS یا
دیسک خارجی): پشتیبانی که روی همان دیسک است، با خرابی دیسک از بین می‌رود.

**بازیابی** (داده‌های فعلی را با داده‌های پشتیبان جایگزین می‌کند؛ پیش از آن یک پشتیبان
ایمنی می‌گیرد و تأیید می‌خواهد):

</div>

```bash
sudo /opt/sazkara/tools/restore.sh /var/backups/sazkara/20261001-023000
```

<div dir="rtl">

## ۱۲. به‌روزرسانی به نسخه‌ی جدید

تنظیمات، داده‌ها و فایل‌ها بیرون از `/opt/sazkara` هستند، پس به‌روزرسانی فقط خود
برنامه را عوض می‌کند:

</div>

```bash
sudo /opt/sazkara/tools/backup.sh
sudo systemctl stop sazkara
sudo mv /opt/sazkara /opt/sazkara.previous            # kept for rollback
sudo mkdir /opt/sazkara
sudo tar -xzf ~/sazkara-server-NEW-VERSION.tar.gz -C /opt/sazkara
sudo chmod +x /opt/sazkara/tools/*.sh
sudo chown -R sazkara:sazkara /opt/sazkara/app
sudo /opt/sazkara/tools/migrate.sh
sudo systemctl start sazkara
```

<div dir="rtl">

برای بازگشت به نسخه‌ی قبل: سرویس را متوقف کنید، `/opt/sazkara.previous` را به
`/opt/sazkara` برگردانید و پشتیبانی را که در خط اول گرفته شد بازیابی کنید (نسخه‌ی جدید
ممکن است جدول‌ها را تغییر داده باشد).

## ۱۳. رفع اشکال

| نشانه | بررسی |
|---|---|
| پیام قرمز «فقط‌خواندنی» | مجوز نصب نشده یا منقضی شده (گام ۱۰) |
| سایت خطای «502 Bad Gateway» می‌دهد | `sudo systemctl status sazkara` و `sudo journalctl -u sazkara -n 100` |
| سرویس با خطای پایگاه داده بالا نمی‌آید | `DATABASE_URL` در `/etc/sazkara/sazkara.env`؛ `sudo systemctl status postgresql` |
| گزارش‌های PDF ساخته نمی‌شوند | فایل `CHROME_PATH` وجود داشته باشد؛ فونت‌های گام ۲ نصب باشند |
| متن فارسی PDF به‌صورت مربع دیده می‌شود | `sudo apt install fonts-vazirmatn fonts-noto-core` و سپس `sudo systemctl restart sazkara` |
| بارگذاری عکس انجام نمی‌شود | `client_max_body_size` در پیکربندی Nginx؛ فضای خالی دیسک (`df -h`) |
| همه‌ی کاربران از حساب خارج شدند | `AUTH_SECRET` تغییر کرده — طبیعی است، دوباره وارد شوید |

</div>
