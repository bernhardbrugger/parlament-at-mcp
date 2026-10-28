// Does list 101 honour sortrnr/ascDesc? Prints the dates of the first rows with and without sorting. One request per second.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dates(vhg, extra) {
  const url = `https://www.parlament.gv.at/Filter/api/filter/data/101?js=eval&showAll=true&page=1&pagesize=6${extra}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'parlament-at-mcp probe (+https://github.com/bernhardbrugger/parlament-at-mcp)',
    },
    body: JSON.stringify({ NRBR: ['NR'], GP_CODE: ['XXVIII'], VHG: [vhg] }),
  });
  const j = await res.json();
  return j.rows.map((r) => `${r[2]}/${r[1]} ${r[8]}`).join(' | ');
}

for (const vhg of ['EU', 'RV', 'PET']) {
  console.log(`${vhg} default      : ${await dates(vhg, '')}`);
  await sleep(1000);
  console.log(`${vhg} sort 9 DESC  : ${await dates(vhg, '&sortrnr=9&ascDesc=DESC')}`);
  await sleep(1000);
}
