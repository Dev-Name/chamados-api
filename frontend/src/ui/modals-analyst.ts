import type { Analyst, AnalystAbsence } from "../core/state";
import { store, WEEK_DOW } from "../core/state";
import { api, reloadAfterMutation } from "../core/api";
import {
  capOfDow,
  lunchForDow,
  workRange,
  scheduleLabel,
  lunchLabel,
  avatarHtml,
  todayLocalISO,
  isoDateOf,
  isTerminated,
  unavailabilityLabel,
} from "../core/analysts";
import { esc, min2time, timeToMin } from "../core/format";
import { openModal, showToast } from "./chrome";

const ANA_DAYS = [
  { d: 1, label: "Seg" },
  { d: 2, label: "Ter" },
  { d: 3, label: "Qua" },
  { d: 4, label: "Qui" },
  { d: 5, label: "Sex" },
  { d: 6, label: "Sáb" },
  { d: 0, label: "Dom" },
];

const pendingPhotos = new Map<string | number, string | null>();
const editingFerias = new Map<string, number | null>();
const editingAbsence = new Map<string, number | null>();

function fmtBrasil(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Data local "AAAA-MM-DD" do instante ISO (para exibição de ausências). */
function localDateOf(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Período de férias: "01/10/2026 até 15/11/2026" (ou só a data, se for 1 dia). */
function feriasRangeLabel(x: AnalystAbsence): string {
  const d1 = fmtBrasil(localDateOf(x.data_hora_inicio));
  const d2 = fmtBrasil(localDateOf(x.data_hora_fim));
  return d1 === d2 ? d1 : `${d1} até ${d2}`;
}

const ABS_TYPE_LABELS: Record<string, string> = {
  FERIAS: "Férias",
  FOLGA: "Folga",
  ATESTADO: "Atestado",
  OUTRO: "Outro",
};

const ABS_PILL: Record<string, string> = {
  FERIAS: "q-pill fer",
  FOLGA: "q-pill fol",
  ATESTADO: "q-pill at",
  OUTRO: "q-pill ot",
};

const ICON_PEN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
const ICON_TRASH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';

/** "HH:mm" local do instante ISO. */
function timeOfIso(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Intervalo de uma ausência que conflita com o período tentado (vem do backend em /absences 409). */
interface ConflictRange {
  data_hora_inicio: string;
  data_hora_fim: string;
}

function conflictOf(err: unknown): ConflictRange | null {
  const body = (err as { body?: { conflict?: ConflictRange } }).body;
  return body?.conflict ?? null;
}

/** `true` quando o intervalo da ausência cruza o período conflitante informado. */
function inConflict(x: AnalystAbsence, c: ConflictRange | null | undefined): boolean {
  return !!c && x.data_hora_inicio <= c.data_hora_fim && c.data_hora_inicio <= x.data_hora_fim;
}

/**
 * Coluna "Período":
 *  - Dia inteiro: "01/10/2026 até 15/11/2026" (ou só a data, se for 1 dia);
 *  - Mesmo dia com horário: "25/09/2026 das 14:00 às 14:30";
 *  - Dias diferentes com horário: "25/09/2026 22:00 até 26/09/2026 02:00".
 */
function absenceRangeLabel(x: AnalystAbsence): string {
  const d1 = fmtBrasil(localDateOf(x.data_hora_inicio));
  if (x.dia_inteiro) {
    const d2 = fmtBrasil(localDateOf(x.data_hora_fim));
    return d1 === d2 ? d1 : `${d1} até ${d2}`;
  }
  const t1 = timeOfIso(x.data_hora_inicio);
  const t2 = timeOfIso(x.data_hora_fim);
  const d2 = fmtBrasil(localDateOf(x.data_hora_fim));
  return d1 === d2 ? `${d1} das ${t1} às ${t2}` : `${d1} ${t1} até ${d2} ${t2}`;
}

function setAnalystHeader(prefix: string, name: string, sub: string): void {
  const t = document.getElementById("a-modal-title")!;
  t.innerHTML = prefix + (name ? " <span class=\"a-title-name\">" + esc(name) + "</span>" : "");
  document.getElementById("a-modal-sub")!.textContent = sub;
}

export function renderAnalystList(): void {
  const back = document.querySelector<HTMLElement>("[data-a-back-head]");
  if (back) back.hidden = true;
  document.getElementById("a-add")!.hidden = false;
  setAnalystHeader("Analistas", "", "Gerencie a equipe, os horários e a jornada de trabalho");
  const list = document.getElementById("analystsList")!;
  list.innerHTML = "";
  for (const a of store.analysts) {
    const id = a.id;
    const row = document.createElement("div");
    row.className = "an-row brief";
    const capLine = scheduleLabel(a);
    const hasLunch = WEEK_DOW.some((d) => lunchForDow(a, d));
    const lunchLine = hasLunch ? lunchLabel(a) : "";
    const activeCount = a.tickets.filter((t) => t.status !== "COMPLETED").length;
    const badgeTxt = activeCount + " chamado" + (activeCount === 1 ? "" : "s") + " ativo" + (activeCount === 1 ? "" : "s");
    const un = unavailabilityLabel(a);
    row.innerHTML = `
        <div class="top">
          <span class="nm">${avatarHtml(a)} ${esc(a.name)}</span>
          <div class="a-actions">
            ${un ? `<span class="a-badge inact">${un === "desligado" ? "Desligado" : "Ausente"}</span>` : ""}
            <span class="a-badge${activeCount ? "" : " off"}">${badgeTxt}</span>
            <button class="ghost sm" data-a-edit="${id}">Editar</button>
            <button type="button" class="icon-btn danger" data-a-del="${id}" title="Excluir analista">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            </button>
          </div>
        </div>
        <div class="brief-line">${capLine}</div>
        ${hasLunch ? `<div class="brief-line sub">Almoço: <b>${lunchLine}</b></div>` : ""}`;
    list.appendChild(row);
    row.querySelector("[data-a-edit]")!.addEventListener("click", () => openAnalystForm(id));
    row.querySelector("[data-a-del]")!.addEventListener("click", async () => {
      if (!window.confirm("Excluir analista? Os chamados ficarão sem dono.")) return;
      try {
        await api(`/analysts/${id}`, "DELETE");
        showToast("Analista excluído");
        await reloadAfterMutation();
        renderAnalystList();
      } catch (e) {
        showToast("Erro: " + (e as Error).message);
      }
    });
  }
}

export function openAnalystForm(id: number | null): void {
  const list = document.getElementById("analystsList")!;
  const isNew = id == null;
  const aid = isNew ? "new" : String(Number(id));
  const a: Analyst | null = isNew
    ? {
        id: 0,
        name: "",
        photo: null,
        weeklyCapacityMinutes: [0, 480, 480, 480, 480, 480, 480],
        weeklyStartMinutes: [],
        lunchStartMinutes: null,
        lunchEndMinutes: null,
        weeklyLunchStartMinutes: [],
        weeklyLunchEndMinutes: [],
        workDays: [],
        dailyCapacityMinutes: 480,
        data_desligamento: null,
        absences: [],
        tickets: [],
      }
    : store.analysts.find((x) => x.id === Number(id)) || null;
  if (!a) return;
  document.getElementById("a-add")!.hidden = true;
  const back = document.querySelector<HTMLElement>("[data-a-back-head]");
  if (back) back.hidden = false;
  setAnalystHeader(
    isNew ? "Novo Analista" : "Editar Analista",
    isNew ? "" : a.name || "",
    isNew ? "Preencha os dados e defina a jornada de trabalho" : "Ajuste os dados e a jornada de trabalho do colaborador"
  );
  list.innerHTML = "";
  const row = document.createElement("div");
  row.className = "an-row form";
  list.appendChild(row);
  row.innerHTML = `
      <div class="a-tabs">
        <button type="button" class="a-tab-btn active" data-a-tab="${aid}" data-tg="dados">Dados</button>
        <button type="button" class="a-tab-btn" data-a-tab="${aid}" data-tg="jornada">Jornada</button>
        <button type="button" class="a-tab-btn" data-a-tab="${aid}" data-tg="ferias">Férias</button>
        <button type="button" class="a-tab-btn" data-a-tab="${aid}" data-tg="ausencias">Ausências</button>
      </div>
      <div class="a-tab-panel" data-a-panel="${aid}" data-pn="dados">
        <div class="a-form-head">
          <div class="a-photo-field">
            <label class="a-photo-box${a.photo ? " has" : ""}" title="Selecionar foto (opcional)">
              <img class="a-photo-img" data-a-photo-img="${aid}" ${a.photo ? `src="${a.photo}"` : "hidden"}>
              <span class="a-photo-plus" data-a-photo-plus="${aid}" ${a.photo ? "hidden" : ""}>+</span>
              <span class="a-photo-cap" data-a-photo-cap="${aid}" ${a.photo ? "hidden" : ""}>Alterar</span>
              <input type="file" accept="image/*" data-a-photo-in="${aid}" hidden>
            </label>
            <button type="button" class="a-photo-del" data-a-photo-del="${aid}" ${a.photo ? "" : "hidden"} title="Remover foto">×</button>
          </div>
          <div class="field name-field"><label>Nome</label><input type="text" data-a-name="${aid}" value="${esc(a.name || "")}" placeholder="Nome do analista"></div>
        </div>
        <div class="a-status-sec">
          <label class="a-status-row">
            <input type="checkbox" class="a-tgl" data-a-desl="${aid}" ${a.data_desligamento ? "checked" : ""}>
            <span class="a-status-txt">
              <b>Funcionário desligado</b>
              <small>Bloqueia novas atribuições de chamados</small>
            </span>
          </label>
          <div class="a-desl-date" data-a-desl-date="${aid}" ${a.data_desligamento ? "" : "hidden"}>
            <div class="field a-desl-date-field"><label>Data de desligamento</label><input type="date" data-a-desl-in="${aid}" value="${isoDateOf(a.data_desligamento) || ""}"></div>
            <span class="a-desl-hint" data-a-desl-hint="${aid}"></span>
          </div>
        </div>
      </div>
      <div class="a-tab-panel" data-a-panel="${aid}" data-pn="jornada" hidden>
        <div class="a-sched">
          <table class="a-sched-table">
            <thead>
              <tr>
                <th>Dia</th>
                <th class="tgl-col">Ativo</th>
                <th>Entrada / Saída expediente</th>
                <th>Entrada / Saída almoço</th>
              </tr>
            </thead>
            <tbody>
              ${ANA_DAYS.map(({ d, label }) => {
                const active = capOfDow(a, d) > 0;
                const r = workRange(a, d);
                const ws = active && r ? min2time(r.start) : "";
                const we = active && r ? min2time(r.end) : "";
                const lun = lunchForDow(a, d);
                const ls = lun ? min2time(lun.start) : "";
                const le = lun ? min2time(lun.end) : "";
                return `<tr class="a-row${active ? "" : " off"}" data-a-row="${aid}" data-dow="${d}">
                  <td class="a-day-nm">${label}</td>
                  <td class="tgl-col"><input type="checkbox" class="a-tgl" data-a-on="${aid}" data-dow="${d}" title="Dia ativo" ${active ? "checked" : ""}></td>
                  <td><div class="a-timepair"><input type="time" data-a-ws="${aid}" data-dow="${d}" value="${ws}" placeholder="HH:mm"${active ? "" : " disabled"}><span class="sep">–</span><input type="time" data-a-we="${aid}" data-dow="${d}" value="${we}" placeholder="HH:mm"${active ? "" : " disabled"}></div></td>
                  <td><div class="a-timepair"><input type="time" data-a-ls="${aid}" data-dow="${d}" value="${ls}" placeholder="HH:mm"${active ? "" : " disabled"}><span class="sep">–</span><input type="time" data-a-le="${aid}" data-dow="${d}" value="${le}" placeholder="HH:mm"${active ? "" : " disabled"}></div></td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>
      <div class="a-tab-panel a-q-panel" data-a-panel="${aid}" data-pn="ferias" hidden>
        <div class="a-q-head">Férias</div>
        ${isNew
            ? `<p class="a-q-empty">Salve o analista para cadastrar férias.</p>`
            : `
        <div class="a-q-add">
          <input type="date" data-fer-start="${aid}" title="Data início">
          <input type="date" data-fer-end="${aid}" title="Data fim">
          <button type="button" class="primary a-q-btn" data-fer-add="${aid}">+ Adicionar</button>
          <button type="button" class="ghost a-q-btn" data-fer-cancel="${aid}" hidden>Cancelar</button>
        </div>
        <div class="a-q-list" data-fer-list="${aid}"></div>`}
      </div>
      <div class="a-tab-panel a-q-panel" data-a-panel="${aid}" data-pn="ausencias" hidden>
        <div class="a-q-head">Ausências</div>
        ${isNew
            ? `<p class="a-q-empty">Salve o analista para cadastrar ausências.</p>`
            : `
        <div class="a-q-add full" data-abs-addbar="${aid}">
          <select data-abs-tipo="${aid}">
            <option value="FOLGA">Folga</option>
            <option value="ATESTADO">Atestado</option>
            <option value="OUTRO">Outro</option>
          </select>
          <label class="a-q-tgl"><input type="checkbox" class="a-tgl" data-abs-full="${aid}" checked>Dia inteiro</label>
          <div class="a-q-main">
            <div class="a-q-mode" data-mode="full">
              <div class="a-q-when">
                <span class="a-q-when-lbl">Início</span>
                <div class="a-q-when-row"><input type="date" data-abs-start-full="${aid}" title="Data início"></div>
              </div>
              <span class="a-q-sep">até</span>
              <div class="a-q-when">
                <span class="a-q-when-lbl">Fim</span>
                <div class="a-q-when-row"><input type="date" data-abs-end-full="${aid}" title="Data fim"></div>
              </div>
            </div>
            <div class="a-q-mode" data-mode="partial">
              <div class="a-q-when">
                <span class="a-q-when-lbl">Início</span>
                <div class="a-q-when-row"><input type="date" data-abs-start-date="${aid}" title="Data início"><input type="time" data-abs-start-time="${aid}" title="Hora início"></div>
              </div>
            <span class="a-q-sep">até</span>
            <div class="a-q-when">
              <span class="a-q-when-lbl">Fim</span>
              <div class="a-q-when-row"><input type="date" data-abs-end-date="${aid}" title="Data fim"><input type="time" data-abs-end-time="${aid}" title="Hora fim"></div>
            </div>
          </div>
          </div>
          <input type="text" data-abs-desc="${aid}" maxlength="300" placeholder="Motivo / Obs">
          <button type="button" class="primary a-q-btn" data-abs-add="${aid}">+ Adicionar</button>
          <button type="button" class="ghost a-q-btn" data-abs-cancel="${aid}" hidden>Cancelar</button>
        </div>
        <div class="a-q-list" data-abs-list="${aid}"></div>`}
      </div>
      <div class="a-form-foot">
        <button type="button" class="ghost" data-a-cancel="${aid}">Cancelar</button>
        <button type="button" class="primary" data-a-save="${aid}">Salvar alterações</button>
      </div> `;
  const photoBox = row.querySelector<HTMLElement>(".a-photo-box")!;
  const setPhoto = (src: string | null) => {
    const img = row.querySelector<HTMLElement>("[data-a-photo-img]")!;
    const plus = row.querySelector<HTMLElement>("[data-a-photo-plus]")!;
    const cap = row.querySelector<HTMLElement>("[data-a-photo-cap]")!;
    const del = row.querySelector<HTMLElement>("[data-a-photo-del]")!;
    if (src) {
      img.setAttribute("src", src);
      img.hidden = false;
      plus.hidden = true;
      cap.hidden = true;
      del.hidden = false;
      photoBox.classList.add("has");
    } else {
      img.removeAttribute("src");
      img.hidden = true;
      plus.hidden = false;
      cap.hidden = false;
      del.hidden = true;
      photoBox.classList.remove("has");
    }
  };
  setPhoto(pendingPhotos.has(aid) ? pendingPhotos.get(aid) || null : a.photo);
  row.querySelector<HTMLInputElement>("[data-a-photo-in]")!.addEventListener("change", (ev) => {
    const inp = (ev.target as HTMLElement).closest<HTMLInputElement>("[data-a-photo-in]")!;
    const file = inp.files && inp.files[0];
    if (!file || !file.type.startsWith("image/")) {
      showToast("Selecione uma imagem");
      return;
    }
    if (file.size > 2.5 * 1024 * 1024) {
      showToast("Imagem muito grande (máx. 2,5 MB)");
      return;
    }
    const fr = new FileReader();
    fr.onload = () => {
      if (isNew) pendingPhotos.set("new", String(fr.result));
      else pendingPhotos.set(Number(id), String(fr.result));
      setPhoto(String(fr.result));
    };
    fr.readAsDataURL(file);
  });
  row.querySelector<HTMLButtonElement>("[data-a-photo-del]")!.addEventListener("click", () => {
    if (isNew) pendingPhotos.set("new", null);
    else pendingPhotos.set(Number(id), null);
    setPhoto(null);
  });
  row.querySelectorAll<HTMLInputElement>("[data-a-on]").forEach((tgl) => {
    tgl.addEventListener("change", () => {
      const tr = tgl.closest("tr")!;
      tr.classList.toggle("off", !tgl.checked);
      tr.querySelectorAll<HTMLInputElement>('input[type="time"]').forEach((i) => {
        i.disabled = !tgl.checked;
      });
    });
  });

  // ---- Navegação por abas ----
  row.querySelectorAll<HTMLElement>(`[data-a-tab="${aid}"]`).forEach((btn) => {
    btn.addEventListener("click", () => {
      const tg = btn.dataset.tg;
      row.querySelectorAll<HTMLElement>(`[data-a-tab="${aid}"]`).forEach((b) => b.classList.toggle("active", b.dataset.tg === tg));
      row.querySelectorAll<HTMLElement>(`[data-a-panel="${aid}"]`).forEach((p) => {
        p.hidden = p.dataset.pn !== tg;
      });
    });
  });

  // ---- Status e desligamento ----
  const updateDeslHint = (): void => {
    const box = row.querySelector<HTMLInputElement>(`[data-a-desl="${aid}"]`)!;
    const hint = row.querySelector<HTMLElement>(`[data-a-desl-hint="${aid}"]`)!;
    if (!box || !hint) return;
    if (!box.checked) {
      hint.textContent = "";
      return;
    }
    const v = (row.querySelector<HTMLInputElement>(`[data-a-desl-in="${aid}"]`)!.value || "").trim();
    if (!v) {
      hint.textContent = "Informe a data de desligamento.";
      return;
    }
    hint.textContent =
      v <= todayLocalISO()
        ? `Analista tratado como desligado desde ${fmtBrasil(v)} — novas atribuições de chamados ficam bloqueadas.`
        : `Desligamento agendado para ${fmtBrasil(v)} — ainda ativo até essa data.`;
  };
  row.querySelector<HTMLInputElement>(`[data-a-desl="${aid}"]`)!.addEventListener("change", () => {
    const box = row.querySelector<HTMLInputElement>(`[data-a-desl="${aid}"]`)!;
    const dateWrap = row.querySelector<HTMLElement>(`[data-a-desl-date="${aid}"]`)!;
    dateWrap.hidden = !box.checked;
    const inp = row.querySelector<HTMLInputElement>(`[data-a-desl-in="${aid}"]`)!;
    if (box.checked && !inp.value) inp.value = todayLocalISO();
    updateDeslHint();
  });
  row.querySelector<HTMLInputElement>(`[data-a-desl-in="${aid}"]`)!.addEventListener("change", updateDeslHint);
  updateDeslHint();

  // ---- Férias ----
  const absencesOf = (): AnalystAbsence[] =>
    isNew ? [] : store.analysts.find((x) => x.id === Number(id))?.absences || [];
  const resetFerForm = (): void => {
    row.querySelector<HTMLInputElement>(`[data-fer-start="${aid}"]`)!.value = "";
    row.querySelector<HTMLInputElement>(`[data-fer-end="${aid}"]`)!.value = "";
    row.querySelector<HTMLButtonElement>(`[data-fer-add="${aid}"]`)!.textContent = "+ Adicionar";
    row.querySelector<HTMLButtonElement>(`[data-fer-cancel="${aid}"]`)!.hidden = true;
  };
  const renderFeriasList = (conflict?: ConflictRange | null): void => {
    const container = row.querySelector<HTMLElement>(`[data-fer-list="${aid}"]`);
    if (!container) return;
    const items = absencesOf().filter((x) => x.tipo === "FERIAS");
    if (!items.length) {
      container.innerHTML = `<p class="a-q-empty">Nenhum período de férias cadastrado.</p>`;
      return;
    }
    container.innerHTML = `
      <table class="a-q-table">
        <thead><tr><th>Tipo</th><th>Período</th><th class="tac">Ações</th></tr></thead>
        <tbody>
        ${items
          .slice()
          .sort((x, y) => x.data_hora_inicio.localeCompare(y.data_hora_inicio))
          .map(
            (x) => `
        <tr data-id="${x.id}"${inConflict(x, conflict) ? ' class="q-hl" title="Conflita com o período informado"' : ""}>
          <td><span class="q-pill fer">Férias</span></td>
          <td class="q-dt">${esc(feriasRangeLabel(x))}</td>
          <td class="q-ac">
            <button type="button" class="q-ic" data-fer-edit="${x.id}" title="Editar">${ICON_PEN}</button>
            <button type="button" class="q-ic danger" data-fer-del="${x.id}" title="Excluir">${ICON_TRASH}</button>
          </td>
        </tr>`
          )
          .join("")}
        </tbody>
      </table>`;
    container.querySelectorAll<HTMLElement>("[data-fer-edit]").forEach((b) =>
      b.addEventListener("click", () => {
        const item = absencesOf().find((x) => x.id === Number(b.dataset.ferEdit));
        if (!item) return;
        row.querySelector<HTMLInputElement>(`[data-fer-start="${aid}"]`)!.value = localDateOf(item.data_hora_inicio);
        row.querySelector<HTMLInputElement>(`[data-fer-end="${aid}"]`)!.value = localDateOf(item.data_hora_fim);
        editingFerias.set(aid, item.id);
        row.querySelector<HTMLButtonElement>(`[data-fer-add="${aid}"]`)!.textContent = "Salvar";
        row.querySelector<HTMLButtonElement>(`[data-fer-cancel="${aid}"]`)!.hidden = false;
      })
    );
    container.querySelectorAll<HTMLElement>("[data-fer-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!window.confirm("Remover este período de férias?")) return;
        try {
          await api(`/analysts/${Number(id)}/absences/${b.dataset.ferDel}`, "DELETE");
          showToast("Férias removidas");
          editingFerias.set(aid, null);
          resetFerForm();
          await reloadAfterMutation();
          renderFeriasList();
        } catch (e) {
          showToast("Erro: " + (e as Error).message);
        }
      })
    );
  };
  if (!isNew) {
    row.querySelector<HTMLButtonElement>(`[data-fer-add="${aid}"]`)!.addEventListener("click", async () => {
      const start = (row.querySelector<HTMLInputElement>(`[data-fer-start="${aid}"]`)!.value || "").trim();
      const end = (row.querySelector<HTMLInputElement>(`[data-fer-end="${aid}"]`)!.value || "").trim();
      if (!start || !end) {
        showToast("Informe as datas inicial e final");
        return;
      }
      if (end < start) {
        showToast("A data final deve ser igual ou posterior à inicial");
        return;
      }
      const body = {
        tipo: "FERIAS",
        dia_inteiro: true,
        data_hora_inicio: new Date(start + "T00:00:00").toISOString(),
        data_hora_fim: new Date(end + "T23:59:59.999").toISOString(),
        descricao: null,
      };
      const ferId = editingFerias.get(aid) ?? null;
      try {
        if (ferId) await api(`/analysts/${Number(id)}/absences/${ferId}`, "PATCH", body);
        else await api(`/analysts/${Number(id)}/absences`, "POST", body);
        showToast(ferId ? "Férias atualizadas" : "Férias cadastradas");
        editingFerias.set(aid, null);
        resetFerForm();
        await reloadAfterMutation();
        renderFeriasList();
      } catch (e) {
        const conflict = conflictOf(e);
        showToast("Erro: " + (e as Error).message);
        renderFeriasList(conflict);
        if (conflict) renderAbsenceList(conflict);
      }
    });
    row.querySelector<HTMLButtonElement>(`[data-fer-cancel="${aid}"]`)!.addEventListener("click", () => {
      editingFerias.set(aid, null);
      resetFerForm();
    });
    renderFeriasList();
  }

  // ---- Ausências pontuais ----
  const syncAbsDayMode = (): void => {
    const full = row.querySelector<HTMLInputElement>(`[data-abs-full="${aid}"]`)!.checked;
    const bar = row.querySelector<HTMLElement>(`[data-abs-addbar="${aid}"]`)!;
    bar.classList.toggle("partial", !full);
    bar.classList.toggle("full", full);
  };
  const resetAbsForm = (): void => {
    (row.querySelector<HTMLSelectElement>(`[data-abs-tipo="${aid}"]`)!).value = "FOLGA";
    row.querySelector<HTMLInputElement>(`[data-abs-full="${aid}"]`)!.checked = true;
    syncAbsDayMode();
    row.querySelector<HTMLInputElement>(`[data-abs-start-full="${aid}"]`)!.value = "";
    row.querySelector<HTMLInputElement>(`[data-abs-end-full="${aid}"]`)!.value = "";
    row.querySelector<HTMLInputElement>(`[data-abs-start-date="${aid}"]`)!.value = "";
    row.querySelector<HTMLInputElement>(`[data-abs-start-time="${aid}"]`)!.value = "";
    row.querySelector<HTMLInputElement>(`[data-abs-end-date="${aid}"]`)!.value = "";
    row.querySelector<HTMLInputElement>(`[data-abs-end-time="${aid}"]`)!.value = "";
    row.querySelector<HTMLInputElement>(`[data-abs-desc="${aid}"]`)!.value = "";
    row.querySelector<HTMLButtonElement>(`[data-abs-add="${aid}"]`)!.textContent = "+ Adicionar";
    row.querySelector<HTMLButtonElement>(`[data-abs-cancel="${aid}"]`)!.hidden = true;
  };
  const renderAbsenceList = (conflict?: ConflictRange | null): void => {
    const container = row.querySelector<HTMLElement>(`[data-abs-list="${aid}"]`);
    if (!container) return;
    const items = absencesOf().filter((x) => x.tipo !== "FERIAS");
    if (!items.length) {
      container.innerHTML = `<p class="a-q-empty">Nenhuma ausência cadastrada.</p>`;
      return;
    }
    container.innerHTML = `
      <table class="a-q-table">
        <thead><tr><th>Tipo</th><th>Período</th><th>Motivo</th><th class="tac">Ações</th></tr></thead>
        <tbody>
        ${items
          .slice()
          .sort((x, y) => x.data_hora_inicio.localeCompare(y.data_hora_inicio))
          .map(
            (x) => `
        <tr data-id="${x.id}"${inConflict(x, conflict) ? ' class="q-hl" title="Conflita com o período informado"' : ""}>
          <td><span class="${ABS_PILL[x.tipo] || "q-pill ot"}">${esc(ABS_TYPE_LABELS[x.tipo] || x.tipo)}</span></td>
          <td class="q-dt">${esc(absenceRangeLabel(x))}</td>
          <td class="q-mo">${x.descricao ? esc(x.descricao) : "—"}</td>
          <td class="q-ac">
            <button type="button" class="q-ic" data-abs-edit="${x.id}" title="Editar">${ICON_PEN}</button>
            <button type="button" class="q-ic danger" data-abs-del="${x.id}" title="Excluir">${ICON_TRASH}</button>
          </td>
        </tr>`
          )
          .join("")}
        </tbody>
      </table>`;
    container.querySelectorAll<HTMLElement>("[data-abs-edit]").forEach((b) =>
      b.addEventListener("click", () => {
        const item = absencesOf().find((x) => x.id === Number(b.dataset.absEdit));
        if (!item) return;
        (row.querySelector<HTMLSelectElement>(`[data-abs-tipo="${aid}"]`)!).value = item.tipo;
        row.querySelector<HTMLInputElement>(`[data-abs-full="${aid}"]`)!.checked = !!item.dia_inteiro;
        if (item.dia_inteiro) {
          row.querySelector<HTMLInputElement>(`[data-abs-start-full="${aid}"]`)!.value = localDateOf(item.data_hora_inicio);
          row.querySelector<HTMLInputElement>(`[data-abs-end-full="${aid}"]`)!.value = localDateOf(item.data_hora_fim);
        } else {
          row.querySelector<HTMLInputElement>(`[data-abs-start-date="${aid}"]`)!.value = localDateOf(item.data_hora_inicio);
          row.querySelector<HTMLInputElement>(`[data-abs-start-time="${aid}"]`)!.value = timeOfIso(item.data_hora_inicio);
          row.querySelector<HTMLInputElement>(`[data-abs-end-date="${aid}"]`)!.value = localDateOf(item.data_hora_fim);
          row.querySelector<HTMLInputElement>(`[data-abs-end-time="${aid}"]`)!.value = timeOfIso(item.data_hora_fim);
        }
        row.querySelector<HTMLInputElement>(`[data-abs-desc="${aid}"]`)!.value = item.descricao || "";
        syncAbsDayMode();
        editingAbsence.set(aid, item.id);
        row.querySelector<HTMLButtonElement>(`[data-abs-add="${aid}"]`)!.textContent = "Salvar";
        row.querySelector<HTMLButtonElement>(`[data-abs-cancel="${aid}"]`)!.hidden = false;
      })
    );
    container.querySelectorAll<HTMLElement>("[data-abs-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!window.confirm("Remover esta ausência?")) return;
        try {
          await api(`/analysts/${Number(id)}/absences/${b.dataset.absDel}`, "DELETE");
          showToast("Ausência removida");
          editingAbsence.set(aid, null);
          resetAbsForm();
          await reloadAfterMutation();
          renderAbsenceList();
        } catch (e) {
          showToast("Erro: " + (e as Error).message);
        }
      })
    );
  };
  if (!isNew) {
    row.querySelector<HTMLInputElement>(`[data-abs-full="${aid}"]`)!.addEventListener("change", syncAbsDayMode);
    row.querySelector<HTMLButtonElement>(`[data-abs-add="${aid}"]`)!.addEventListener("click", async () => {
      const tipo = row.querySelector<HTMLSelectElement>(`[data-abs-tipo="${aid}"]`)!.value;
      const diaInteiro = row.querySelector<HTMLInputElement>(`[data-abs-full="${aid}"]`)!.checked;
      let inicio: string;
      let fim: string;
      if (diaInteiro) {
        const start = (row.querySelector<HTMLInputElement>(`[data-abs-start-full="${aid}"]`)!.value || "").trim();
        const end = (row.querySelector<HTMLInputElement>(`[data-abs-end-full="${aid}"]`)!.value || "").trim();
        if (!start || !end) {
          showToast("Informe as datas inicial e final");
          return;
        }
        if (end < start) {
          showToast("A data final deve ser igual ou posterior à inicial");
          return;
        }
        inicio = new Date(start + "T00:00:00").toISOString();
        fim = new Date(end + "T23:59:59.999").toISOString();
      } else {
        const sDate = (row.querySelector<HTMLInputElement>(`[data-abs-start-date="${aid}"]`)!.value || "").trim();
        const sTime = (row.querySelector<HTMLInputElement>(`[data-abs-start-time="${aid}"]`)!.value || "").trim();
        const eDate = (row.querySelector<HTMLInputElement>(`[data-abs-end-date="${aid}"]`)!.value || "").trim();
        const eTime = (row.querySelector<HTMLInputElement>(`[data-abs-end-time="${aid}"]`)!.value || "").trim();
        if (!sDate || !eDate) {
          showToast("Informe as datas de início e de fim");
          return;
        }
        if (!sTime || !eTime) {
          showToast("Informe a hora de início e de fim");
          return;
        }
        inicio = new Date(sDate + "T" + sTime + ":00").toISOString();
        fim = new Date(eDate + "T" + eTime + ":00").toISOString();
        if (fim <= inicio) {
          showToast("O fim deve ser depois do início");
          return;
        }
      }
      const descricao = (row.querySelector<HTMLInputElement>(`[data-abs-desc="${aid}"]`)!.value || "").trim() || null;
      const body = { tipo, dia_inteiro: diaInteiro, data_hora_inicio: inicio, data_hora_fim: fim, descricao };
      const absId = editingAbsence.get(aid) ?? null;
      try {
        if (absId) await api(`/analysts/${Number(id)}/absences/${absId}`, "PATCH", body);
        else await api(`/analysts/${Number(id)}/absences`, "POST", body);
        showToast(absId ? "Ausência atualizada" : "Ausência cadastrada");
        editingAbsence.set(aid, null);
        resetAbsForm();
        await reloadAfterMutation();
        renderAbsenceList();
      } catch (e) {
        const conflict = conflictOf(e);
        showToast("Erro: " + (e as Error).message);
        renderAbsenceList(conflict);
        if (conflict) renderFeriasList(conflict);
      }
    });
    row.querySelector<HTMLButtonElement>(`[data-abs-cancel="${aid}"]`)!.addEventListener("click", () => {
      editingAbsence.set(aid, null);
      resetAbsForm();
    });
    renderAbsenceList();
  }

  row.querySelector<HTMLButtonElement>("[data-a-cancel]")!.addEventListener("click", () => {
    // Descarta foto pendente ao cancelar sem salvar
    pendingPhotos.delete(aid);
    renderAnalystList();
  });
  list.querySelector<HTMLButtonElement>("[data-a-save]")!.addEventListener("click", async () => {
    const name = (row.querySelector<HTMLInputElement>("[data-a-name]")!.value || "").trim();
    if (!name) {
      showToast("Informe o nome");
      return;
    }
    const weekly = [0, 0, 0, 0, 0, 0, 0];
    const weeklyStart: Array<number | null> = [null, null, null, null, null, null, null];
    const weeklyLunchStart: Array<number | null> = [null, null, null, null, null, null, null];
    const weeklyLunchEnd: Array<number | null> = [null, null, null, null, null, null, null];
    for (const { d, label } of ANA_DAYS) {
      const on = row.querySelector<HTMLInputElement>(`[data-a-on="${aid}"][data-dow="${d}"]`);
      if (!on || !on.checked) continue;
      const ws = timeToMin(row.querySelector<HTMLInputElement>(`[data-a-ws="${aid}"][data-dow="${d}"]`)!.value);
      const we = timeToMin(row.querySelector<HTMLInputElement>(`[data-a-we="${aid}"][data-dow="${d}"]`)!.value);
      if (ws == null || we == null || we <= ws) {
        showToast(`Dia ${label}: informe a entrada e a saída do expediente (fim após o início)`);
        return;
      }
      weekly[d] = Math.min(960, we - ws);
      weeklyStart[d] = ws;
      const ls = timeToMin(row.querySelector<HTMLInputElement>(`[data-a-ls="${aid}"][data-dow="${d}"]`)!.value);
      const le = timeToMin(row.querySelector<HTMLInputElement>(`[data-a-le="${aid}"][data-dow="${d}"]`)!.value);
      if (ls != null || le != null) {
        if (ls == null || le == null || le <= ls) {
          showToast(`Dia ${label}: informe o início e o fim do almoço (fim após o início)`);
          return;
        }
        weeklyLunchStart[d] = ls;
        weeklyLunchEnd[d] = le;
      }
    }
    const legacyStart = weeklyLunchStart.find((v) => v != null) ?? null;
    const legacyEnd = legacyStart != null ? weeklyLunchEnd[weeklyLunchStart.indexOf(legacyStart)] : null;
    const body: Record<string, unknown> = {
      name,
      weeklyCapacityMinutes: weekly,
      weeklyStartMinutes: weeklyStart,
      weeklyLunchStartMinutes: weeklyLunchStart,
      weeklyLunchEndMinutes: weeklyLunchEnd,
      lunchStartMinutes: legacyStart,
      lunchEndMinutes: legacyEnd,
    };
    const photoKey: string | number = isNew ? "new" : Number(id);
    if (pendingPhotos.has(photoKey)) {
      // string = nova foto; null = remoção da foto (persiste o fallback de iniciais)
      body.photo = pendingPhotos.get(photoKey) ?? null;
    }
    const deslBox = row.querySelector<HTMLInputElement>(`[data-a-desl="${aid}"]`)!;
    if (deslBox && deslBox.checked) {
      const deslDate = (row.querySelector<HTMLInputElement>(`[data-a-desl-in="${aid}"]`)!.value || "").trim();
      if (!deslDate) {
        showToast("Informe a data de desligamento");
        return;
      }
      body.data_desligamento = deslDate;
    } else {
      body.data_desligamento = null;
    }
    try {
      if (isNew) await api("/analysts", "POST", body);
      else await api("/analysts/" + Number(id), "PATCH", body);
      if (pendingPhotos.has(photoKey)) pendingPhotos.delete(photoKey);
      editingFerias.delete(aid);
      editingAbsence.delete(aid);
      showToast(isNew ? "Analista criado" : "Alterações salvas");
      await reloadAfterMutation();
      renderAnalystList();
    } catch (e) {
      showToast("Erro: " + (e as Error).message);
    }
  });
}

export function editAnalystFromMenu(id: number): void {
  renderAnalystList();
  openModal("analystsModal");
  openAnalystForm(id);
}

export function wireAnalystsModal(): void {
  document.getElementById("manageAnalysts")?.addEventListener("click", () => {
    renderAnalystList();
    openModal("analystsModal");
  });
  document.getElementById("a-add")?.addEventListener("click", () => openAnalystForm(null));
  const back = document.querySelector<HTMLElement>("[data-a-back-head]");
  back?.addEventListener("click", () => renderAnalystList());
}