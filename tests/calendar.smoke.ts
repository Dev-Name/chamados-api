import { AnalystCalendar } from "../src/lib/calendar";
import dayjs from "dayjs";
import "dayjs/locale/pt-br";
dayjs.locale("pt-br");

function fmt(d: Date): string {
  return dayjs(d).format("ddd DD/MM HH:mm");
}

const work = [1, 2, 3, 4, 5]; // seg-sex
let pass = 0;
let fail = 0;

function check(label: string, got: Date, expected: string) {
  const ok = fmt(got) === expected;
  if (ok) pass++;
  else {
    fail++;
    console.log(`FALHOU ${label}: esperado ${expected}, obteve ${fmt(got)}`);
  }
}

// 1) Capacidade 480 (8h: 09:00-17:00), 3 tickets
const c1 = new AnalystCalendar(work, 480, new Date(2026, 8, 14)); // seg 14/09
check("A", c1.nextAvailableAt().toDate(), "seg 14/09 09:00");
const dueA = c1.allocate(480);
check("dueA", dueA.toDate(), "seg 14/09 17:00");
check("B start", c1.nextAvailableAt().toDate(), "ter 15/09 09:00");
const dueB = c1.allocate(480);
check("dueB", dueB.toDate(), "ter 15/09 17:00");
check("C start", c1.nextAvailableAt().toDate(), "qua 16/09 09:00");
check("C due", c1.allocate(240).toDate(), "qua 16/09 13:00");

// 2) Transbordo: 900 min => seg (480) + ter (420) => ter 09:00+420=16:00
const c2 = new AnalystCalendar(work, 480, new Date(2026, 8, 14));
check("c2 due", c2.allocate(900).toDate(), "ter 15/09 16:00");

// 3) Fim de semana: referência sábado => inicia segunda
const c3 = new AnalystCalendar(work, 480, new Date(2026, 8, 19)); // sáb 19/09
check("c3 start", c3.nextAvailableAt().toDate(), "seg 21/09 09:00");

// 4) Alinhar a dueDate de dependência no meio da jornada (15:00 = 360min da jornada)
//    Soa 120min hoje + 240min amanhã => ter 09:00+240=13:00
const c4 = new AnalystCalendar(work, 480, new Date(2026, 8, 14));
c4.alignTo(dayjs("2026-09-14T15:00:00").toDate());
check("c4 start apos dep", c4.nextAvailableAt().toDate(), "seg 14/09 15:00");
check("c4 due", c4.allocate(360).toDate(), "ter 15/09 13:00");

// 5) Dependência termina no fim da jornada (17:00) => inicia no dia útil seguinte
const c5 = new AnalystCalendar(work, 480, new Date(2026, 8, 14));
c5.alignTo(dayjs("2026-09-14T17:00:00").toDate());
check("c5 start", c5.nextAvailableAt().toDate(), "ter 15/09 09:00");

// 6) Horizonte de 2 semanas: 5 tickets de 480 em sequência
const c6 = new AnalystCalendar(work, 480, new Date(2026, 8, 14));
for (let i = 0; i < 5; i++) c6.allocate(480);
check("c6 inicio semana 2", c6.nextAvailableAt().toDate(), "seg 21/09 09:00");

// 7) Domingo no meio: turno que cruza o domingo
const c7 = new AnalystCalendar([0, 1, 2, 3, 4, 5, 6], 480, new Date(2026, 8, 19)); // 19/09 é sábado
check("c7 dom inicio", c7.nextAvailableAt().toDate(), "sáb 19/09 09:00");
check("c7 dom due (sábi+dom)", c7.allocate(960).toDate(), "dom 20/09 17:00");

// 8) Capacidade por dia da semana: seg/qua/sex 480, ter/qui 240
const c8 = new AnalystCalendar([], 0, new Date(2026, 8, 14), {
  capacityByDay: [0, 480, 240, 480, 240, 480, 0],
});
const dowOk = c8.isWorkDay(new Date(2026, 8, 13)) === false && c8.isWorkDay(new Date(2026, 8, 14)) === true;
if (dowOk) pass++;
else {
  fail++;
  console.log(`FALHOU c8 isWorkDay: dom=false e seg=true esperados`);
}
check("c8 seg inicio", c8.nextAvailableAt().toDate(), "seg 14/09 09:00");
const c8a = new AnalystCalendar([], 0, new Date(2026, 8, 14), { capacityByDay: [0, 480, 240, 480, 240, 480, 0] });
check("c8 seg cheio (480)", c8a.allocate(480).toDate(), "seg 14/09 17:00");
check("c8 proximo ter (240)", c8a.nextAvailableAt().toDate(), "ter 15/09 09:00");
check("c8 ter cheio (240)", c8a.allocate(240).toDate(), "ter 15/09 13:00");
check("c8 cai pra qua (480)", c8a.nextAvailableAt().toDate(), "qua 16/09 09:00");

// 9) Almoço 12:00–13:00 dentro de 09:00–17:00: 420 min produtivos
const lunchOpts = { lunchStartMinutes: 720, lunchEndMinutes: 780 };
const c9 = new AnalystCalendar(work, 480, new Date(2026, 8, 14), lunchOpts);
check("c9 até o almoço", c9.allocate(180).toDate(), "seg 14/09 12:00");
check("c9 retoma depois", c9.nextAvailableAt().toDate(), "seg 14/09 13:00");
check("c9 fecha o dia", c9.allocate(240).toDate(), "seg 14/09 17:00");

const c9b = new AnalystCalendar(work, 480, new Date(2026, 8, 14), lunchOpts);
check("c9b 480 transborda (420+60)", c9b.allocate(480).toDate(), "ter 15/09 10:00");

const c9c = new AnalystCalendar(work, 480, new Date(2026, 8, 14), lunchOpts);
c9c.alignTo(dayjs("2026-09-14T12:30:00").toDate());
check("c9c no almoço", c9c.nextAvailableAt().toDate(), "seg 14/09 13:00");

const c9d = new AnalystCalendar([], 0, new Date(2026, 8, 14), {
  capacityByDay: [0, 480, 480, 480, 480, 480, 0],
  lunchStartByDay: [-1, 720, -1, 720, -1, 720, -1],
  lunchEndByDay: [-1, 780, -1, 780, -1, 780, -1],
});
check("c9d seg com almoço", c9d.allocate(180).toDate(), "seg 14/09 12:00");
const c9e = new AnalystCalendar([], 0, new Date(2026, 8, 15), {
  capacityByDay: [0, 480, 480, 480, 480, 480, 0],
  lunchStartByDay: [-1, 720, -1, 720, -1, 720, -1],
  lunchEndByDay: [-1, 780, -1, 780, -1, 780, -1],
});
check("c9e ter sem almoço", c9e.allocate(480).toDate(), "ter 15/09 17:00");

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);