#!/usr/bin/env zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
STARTER_DIR="/Users/uji/development/restheart-cloud/restheart-cloud-starter-ng"

echo "Building @ulabase/kit..."
npm run build -w packages/kit

echo "Building @ulabase/kit-ng..."
npm run build -w packages/kit-ng

echo "Linking @ulabase/kit..."
npm link -w packages/kit

echo "Linking @ulabase/kit-ng..."
(cd packages/kit-ng/dist && npm link)

echo "Linking into starter..."
cd "$STARTER_DIR" && npm link @ulabase/kit @ulabase/kit-ng

echo "Clearing starter cache..."
rm -rf "$STARTER_DIR/.angular/cache"

cd "$SCRIPT_DIR"
echo "Done. Restart ng serve if needed."
