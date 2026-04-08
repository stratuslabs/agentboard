#!/usr/bin/env node

"use strict";

const { main } = require("../cli/agentboard.js");

main().catch((err) => {
  process.stderr.write(`${err.message || err}\n`);
  process.exit(1);
});
