import type { Analyst } from "../core/state";
import { store, WEEK_DOW } from "../core/state";
import { api, reloadAfterMutation } from "../core/api";
import {
  capOfDow,
  lunchForDow,
  workRange,
  scheduleLabel,
  lunchLabel,
  avatarHtml,
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
    const pv = pendingPhotos.has(id) ? pendingPhotos.get(id) : a.photo;
    const prevSrc = pv || "";
    const row = document.createElement("div");
    row.className = "an-row brief";
    const capLine = scheduleLabel(a);
    const hasLunch = WEEK_DOW.some((d) => lunchForDow(a, d));
    const lunchLine = hasLunch ? lunchLabel(a) : "";
    const activeCount = a.tickets.filter((t) => t.status !== "COMPLETED").length;
    const badgeTxt = activeCount + " chamado" + (activeCount === 1 ? "" : "s") + " ativo" + (activeCount === 1 ? "" : "s");
    row.innerHTML = `
        <div class="top">
          <span class="nm">${avatarHtml(a)} ${esc(a.name)}</span>
          <div class="a-actions">
            <span class="a-badge${activeCount ? "" : " off"}">${badgeTxt}</span>
            <button class="ghost sm" data-a-edit="${id}">Editar</button>
            <button type="button" class="icon-btn danger" data-a-del="${id}" title="Excluir analista">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            </button>
          </div>
        </div>
        <div class="brief-line">${capLine}</div>
        ${hasLunch ? `<div class="brief-line sub">Almoço: <b>${lunchLine}</b></div>` : ""}`;
    void prevSrc;
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
                <td class="a-day-nm">${label.toUpperCase()}</td>
                <td class="tgl-col"><input type="checkbox" class="a-tgl" data-a-on="${aid}" data-dow="${d}" title="Dia ativo" ${active ? "checked" : ""}></td>
                <td><div class="a-timepair"><input type="time" data-a-ws="${aid}" data-dow="${d}" value="${ws}" placeholder="HH:mm"${active ? "" : " disabled"}><span class="sep">–</span><input type="time" data-a-we="${aid}" data-dow="${d}" value="${we}" placeholder="HH:mm"${active ? "" : " disabled"}></div></td>
                <td><div class="a-timepair"><input type="time" data-a-ls="${aid}" data-dow="${d}" value="${ls}" placeholder="HH:mm"${active ? "" : " disabled"}><span class="sep">–</span><input type="time" data-a-le="${aid}" data-dow="${d}" value="${le}" placeholder="HH:mm"${active ? "" : " disabled"}></div></td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
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
  row.querySelector<HTMLButtonElement>("[data-a-cancel]")!.addEventListener("click", () => renderAnalystList());
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
      const pv = pendingPhotos.get(photoKey);
      if (pv) body.photo = pv;
    }
    try {
      if (isNew) await api("/analysts", "POST", body);
      else await api("/analysts/" + Number(id), "PATCH", body);
      if (pendingPhotos.has(photoKey)) pendingPhotos.delete(photoKey);
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