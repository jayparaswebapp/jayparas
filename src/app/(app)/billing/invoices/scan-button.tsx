# make sure your local repo is up to date first
git pull

# apply my changes
git apply ~/Downloads/jayparas-invoice-camera-scan.patch

# install the fallback library (regenerates the lockfile)
npm install

# review, commit, push
git add -A
git commit -m "feat(invoices): camera SKU scanning on mobile"
git push
