npm run compile
rm src
mv lib src
touch index1.js
./node_modules/babel-cli/bin/babel.js -o index1.js index.js
rm index.js
mv index1.js index.js
