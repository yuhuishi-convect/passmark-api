import assert from "node:assert/strict";
import { test } from "node:test";

import { fuzzySearch } from "../src/lib/fuzzy.js";
import { parseCpuTable } from "../src/lib/passmark.js";

test("fuzzySearch prioritizes relevant cpu names", () => {
  const cpus = [
    { id: "a", name: "AMD Ryzen 7 5800X", cpuMark: 28000 },
    { id: "b", name: "Intel Core i7-12700K", cpuMark: 35000 },
    { id: "c", name: "AMD Ryzen 5 5600X", cpuMark: 22000 },
  ];

  const results = fuzzySearch(cpus, "ryzen 5800", 3);
  assert.equal(results[0].id, "a");
  assert.equal(results.length > 0, true);
});

test("parseCpuTable parses score rows from passmark-like table", () => {
  const html = `
    <table>
      <tr><th>CPU Name</th><th>CPU Mark</th><th>Thread Rating</th></tr>
      <tr>
        <td><a href="cpu.php?cpu=AMD+Ryzen+9+9950X">AMD Ryzen 9 9950X</a></td>
        <td>49,120</td>
        <td>4,650</td>
      </tr>
      <tr>
        <td><a href="cpu.php?cpu=Intel+Core+i9-14900K">Intel Core i9-14900K</a></td>
        <td>47,888</td>
        <td>4,440</td>
      </tr>
    </table>
  `;

  const rows = parseCpuTable(html);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "AMD Ryzen 9 9950X");
  assert.equal(rows[0].cpuMark, 49120);
  assert.equal(rows[0].rank, 1);
  assert.equal(rows[1].rank, 2);
});
