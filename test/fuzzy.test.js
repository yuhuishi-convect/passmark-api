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

test("fuzzySearch handles real CPU model queries sensibly", () => {
  const cpus = [
    { id: "7800x3d", name: "AMD Ryzen 7 7800X3D", cpuMark: 34285 },
    { id: "9800x3d", name: "AMD Ryzen 7 9800X3D", cpuMark: 39975 },
    { id: "14900k", name: "Intel Core i9-14900K", cpuMark: 58450 },
    { id: "14900kf", name: "Intel Core i9-14900KF", cpuMark: 58324 },
    { id: "7500f", name: "AMD Ryzen 5 7500F", cpuMark: 26632 },
    { id: "a8-7500", name: "AMD A8-7500", cpuMark: 3302 },
    { id: "rx427", name: "AMD RX-427BB", cpuMark: 2669 },
    { id: "fx7600p", name: "AMD FX-7600P", cpuMark: 2557 },
  ];

  assert.equal(fuzzySearch(cpus, "7800x3d", 1)[0].id, "7800x3d");
  assert.equal(fuzzySearch(cpus, "intel core i9-14900k", 1)[0].id, "14900k");
  assert.equal(fuzzySearch(cpus, "amd 7500f", 1)[0].id, "7500f");
  assert.equal(fuzzySearch(cpus, "amd rx 7700", 1)[0].id, "rx427");
  assert.equal(fuzzySearch(cpus, "rx5700", 1).length, 0);
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
