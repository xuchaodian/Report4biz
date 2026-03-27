#!/bin/bash
cd /Users/xuchaodian/WorkBuddy/20260325092251/frontend
rm -rf dist
NODE_OPTIONS="" /Users/xuchaodian/.workbuddy/binaries/node/versions/22.12.0/bin/node node_modules/vite/bin/vite.js build --mode production
echo "BUILD_DONE"
