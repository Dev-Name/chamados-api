// Smoke canonico do CADASTRO de analista via API real (fluxo POST -> GET lista -> DELETE).
// Fluxo idempotente e restaurativo: POST /analysts (cria com nome teste + sabado 240) -> 201
// -> GET /analysts confirma que o novo id apareceu com nome + sabado 240
// -> DELETE /analysts/:id (remove so o criado) -> GET /analysts confirma ausencia do id -> estado original intacto.
// 100% ASCII; nao deixa nenhum analista para tras: sempre remove o que criar.
import { request } from "node:http";

const BASE = { hostname: "localhost", port: 3000 };
const TEST_NAME = "Cadastro Smoke Temporario";
const SAT_INDEX = 6;
const TEST_SAT_MIN = 240;
const WEEK = [480, 480, 480, 480, 480, 480, 240];

function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        ...BASE,
        path,
        method,
        headers: data
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
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
    if (data) req.write(data);
    req.end();
  });
}

async function listAnalysts(): Promise<any[]> {
  return (await call("GET", "/analysts")).json;
}

async function main() {
  const before = await listAnalysts();
  const idsBefore = new Set(before.map((a: any) => a.id));
  const idBefore = before.length;
  console.log("1/5 antes:", idBefore, "analistas | ids:", JSON.stringify([...idsBefore]));

  const created = (await call("POST", "/analysts", {
    name: TEST_NAME,
    weeklyCapacityMinutes: WEEK,
  }));
  const cj = created.json;
  const createOk = created.status === 201 && !!cj && cj.name === TEST_NAME && cj.weeklyCapacityMinutes?.[SAT_INDEX] === TEST_SAT_MIN;
  const newId = cj?.id;
  console.log("2/5 POST:", created.status, "| id:", newId, "| nome:", cj?.name, "| sab(min):", cj?.weeklyCapacityMinutes?.[SAT_INDEX], "| createOk:", createOk);

  const after = await listAnalysts();
  const found = after.find((a: any) => a.id === newId);
  const nameOk = found?.name === TEST_NAME;
  const satOk = found?.weeklyCapacityMinutes?.[SAT_INDEX] === TEST_SAT_MIN;
  console.log("3/5 GET(pos):", found?.name, "| sab(min):", found?.weeklyCapacityMinutes?.[SAT_INDEX], "| nameOk:", nameOk, "| satOk:", satOk);

  await call("DELETE", "/analysts/" + newId);
  const final = await listAnalysts();
  const removedOk = !final.some((a: any) => a.id === newId) && final.length === idBefore;
  console.log("4/5 DELETE + GET -> len:", final.length, "| sem id " + newId + ":", removedOk);

  if (!createOk || !nameOk || !satOk || !removedOk) {
    console.error("FLUXO DE CADASTRO DE ANALISTA FALHOU (veja etapas acima)");
    process.exit(1);
  }
  console.log("5/5 FLUXO DE CADASTRO DE ANALISTA OK (POST 201 persistiu, DELETE removeu, idempotente e restaurativo)");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
