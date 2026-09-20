// Smoke canonic do fluxo real PATCH de analista (rota: PATCH /analysts/:id).
// Fluxo: GET /analysts -> acha id=1 -> PATCH nome+semana com sabado 240 -> GET /analysts confirma 240
// -> PATCH restaura original -> GET /analysts confirma restauracao. Idempotente e restaura sempre.
import { request } from "node:http";

const BASE_OPTS = { hostname: "localhost", port: 3000 };
const TARGET_ID = 1;
const DOW_INDEX = 6; // 0=Dom..6=Sab
const TEST_SAT_MIN = 240;
const TEST_NAME = "Ana Ribeiro (smoke temp)";

function callApi(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        ...BASE_OPTS,
        path,
        method,
        headers: payload
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let json: any = null;
          try { json = JSON.parse(raw); } catch { json = { _raw: raw }; }
          resolve({ status: res.statusCode ?? 0, json });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function listAnalysts(): Promise<any[]> {
  return (await callApi("GET", "/analysts")).json;
}

async function main() {
  const orig = (await listAnalysts()).find((a: any) => a.id === TARGET_ID);
  if (!orig || !orig.weeklyCapacityMinutes) {
    console.log("etapa1 FALHOU: GET /analysts sem id=" + TARGET_ID + " (servidor na 3000 de pe?)");
    process.exit(1);
  }
  const origName = orig.name;
  const origCap = JSON.stringify(orig.weeklyCapacityMinutes);
  const origD7 = orig.weeklyCapacityMinutes[DOW_INDEX];
  console.log("1/5 orig:", origName, "| sab(min):", origD7);

  const nova = [...orig.weeklyCapacityMinutes];
  nova[DOW_INDEX] = TEST_SAT_MIN; // <-- linha 48, puramente ASCII
  const patch = (await callApi("PATCH", "/analysts/" + TARGET_ID, {
    name: TEST_NAME,
    weeklyCapacityMinutes: nova,
  })).json      ;
  console.log("2/5 PATCH->", patch.name, "| sab(min):", patch.weeklyCapacityMinutes[DOW_INDEX]);

  const after = (await listAnalysts()).find((a: any) => a.id === TARGET_ID);
  const nameOk = after.name === TEST_NAME;
  const sabOk = after.weeklyCapacityMinutes[DOW_INDEX] === TEST_SAT_MIN;
  console.log("3/5 apos:", after.name, "| sab:", after.weeklyCapacityMinutes[DOW_INDEX], "| nameOk:", nameOk, "| sabOk:", sabOk);

  await callApi("PATCH", "/analysts/" + TARGET_ID, { name: origName, weeklyCapacityMinutes: orig.weeklyCapacityMinutes });
  const back = (await listAnalysts()).find((a: any) => a.id === TARGET_ID);
  const restored = back.name === origName && JSON.stringify(back.weeklyCapacityMinutes) === origCap;
  console.log("4/5 restaurado:", back.name, "| sab:", back.weeklyCapacityMinutes[DOW_INDEX], "| restored:", restored);

  if (!nameOk || !sabOk || !restored) {
    console.error("FLUXO DE EDICAO DE ANALISTA FALHOU");
    process.exit(1);
  }
  console.log("5/5 FLUXO DE EDICAO DE ANALISTA OK (persistiu + restaurou, idempotente)");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
