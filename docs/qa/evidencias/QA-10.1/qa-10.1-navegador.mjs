/**
 * QA-10.1 (MP4-110): casos P01 a P10 de la bandeja de notificaciones en el
 * navegador (Chrome headless con Playwright). Deja las capturas junto a este
 * archivo e imprime el resultado de cada caso.
 *
 * Cómo correrlo (no instala nada en los repos):
 *
 *   1. Base aparte, nunca la _test ni la de desarrollo:
 *        docker exec si_be_postgres createdb -U postgres si_be_qa_10_1
 *        DATABASE_URL=postgresql://postgres:<clave>@localhost:5432/si_be_qa_10_1?schema=public \
 *          npx prisma migrate deploy
 *   2. Backend (este repo, después de `npm run build`) en el puerto 3101:
 *        PORT=3101 DATABASE_URL=<la de arriba> node dist/main.js
 *   3. Frontend (fe_boilerplate_is_2026 en main) en el puerto 3100:
 *        API_URL=http://localhost:3101/api/v1 npx next dev -p 3100
 *   4. playwright-core en una carpeta cualquiera fuera de los repos, usando el
 *      Chrome instalado en el sistema (no descarga navegadores):
 *        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i playwright-core
 *   5. Correr:
 *        PLAYWRIGHT_CORE=<carpeta>/node_modules/playwright-core/index.mjs \
 *          node docs/qa/evidencias/QA-10.1/qa-10.1-navegador.mjs
 *   6. Limpiar:
 *        docker exec si_be_postgres dropdb -U postgres --force si_be_qa_10_1
 *
 * Variables opcionales: FE_URL (http://localhost:3100) y API_URL
 * (http://localhost:3101/api/v1).
 *
 * El contador se actualiza cada 30 s; el script usa el reloj de Playwright
 * (page.clock) para adelantar el tiempo en vez de esperarlo.
 */
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const modulo = process.env.PLAYWRIGHT_CORE ?? 'playwright-core';
const { chromium } = await import(
  isAbsolute(modulo) ? pathToFileURL(modulo).href : modulo
);

const FE = process.env.FE_URL ?? 'http://localhost:3100';
const API = process.env.API_URL ?? 'http://localhost:3101/api/v1';
const OUT = dirname(fileURLToPath(import.meta.url));
const TAG = randomUUID().slice(0, 8);
const PASSWORD = 'Clave-QA-10-1';

// --- Utilidades ------------------------------------------------------------

const resultados = [];
const erroresConsola = [];

async function caso(id, descripcion, fn) {
  try {
    const detalle = await fn();
    resultados.push({ id, descripcion, ok: true, detalle });
    console.log(`✅ ${id} ${descripcion}${detalle ? `\n   ${detalle}` : ''}`);
  } catch (error) {
    resultados.push({ id, descripcion, ok: false, detalle: error.message });
    console.log(`❌ ${id} ${descripcion}\n   ${error.message}`);
  }
}

function comprobar(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje);
}

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

/** Repite `fn` hasta que devuelve algo truthy (espera del lado de Node). */
async function esperar(fn, descripcion, ms = 10_000) {
  const limite = Date.now() + ms;
  let ultimo;
  while (Date.now() < limite) {
    ultimo = await fn();
    if (ultimo) return ultimo;
    await pausa(150);
  }
  throw new Error(`No se cumplió: ${descripcion} (último valor: ${ultimo})`);
}

// --- Backend: usuarios y eventos reales -------------------------------------

async function api(metodo, ruta, token, body) {
  const res = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const texto = await res.text();
  const datos = texto ? JSON.parse(texto) : null;
  if (!res.ok) {
    throw new Error(`${metodo} ${ruta} → ${res.status} ${texto}`);
  }
  return datos;
}

async function cuenta(nombre, rol) {
  const email = `qa-10.1-${nombre}-${TAG}@test.local`;
  await api('POST', '/users', null, {
    email,
    password: PASSWORD,
    rol,
    nombre: `QA ${nombre}`,
    telefono: '70001234',
  });
  const { accessToken } = await api('POST', '/auth/login', null, {
    email,
    password: PASSWORD,
  });
  return { email, token: accessToken };
}

/** PNG de 1×1: la publicación exige al menos una fotografía. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** A publica el bien (multipart, con una imagen). */
async function publicar(A) {
  const form = new FormData();
  for (const [k, v] of Object.entries({
    tipo: 'EQUIPO',
    nombre: 'Cámara Canon R6',
    ubicacion: 'San Salvador',
    tarifaMonto: '30.00',
    tarifaUnidad: 'DIA',
    depositoMonto: '15.00',
  })) {
    form.append(k, v);
  }
  form.append('imagenes', new Blob([PNG_1X1], { type: 'image/png' }), 'camara.png');
  const res = await fetch(`${API}/publicaciones`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${A.token}` },
    body: form,
  });
  if (!res.ok) throw new Error(`POST /publicaciones → ${res.status} ${await res.text()}`);
  return res.json();
}

let semana = 0;
let listingId;

/** T solicita una reserva: A recibe «Nueva solicitud de reserva». */
async function solicitud(T) {
  const inicio = new Date(Date.UTC(2027, 8, 1 + 7 * semana++, 15));
  const fin = new Date(inicio.getTime() + 2 * 24 * 3_600_000);
  return api('POST', '/reservas', T.token, {
    publicacionId: listingId,
    inicio: inicio.toISOString(),
    fin: fin.toISOString(),
  });
}

const bandejaApi = (u, soloNoLeidas = false) =>
  api('GET', `/notificaciones?soloNoLeidas=${soloNoLeidas}&limit=100`, u.token);
const conteoApi = async (u) =>
  (await api('GET', '/notificaciones/no-leidas/conteo', u.token)).noLeidas;

// --- Navegador ---------------------------------------------------------------

function vigilar(page, quien) {
  page.on('pageerror', (e) => erroresConsola.push(`[${quien}] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') erroresConsola.push(`[${quien}] ${m.text()}`);
  });
}

async function entrar(page, u) {
  await page.goto(`${FE}/login`);
  await page.fill('#email', u.email);
  await page.fill('#password', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

const campana = (page) => page.locator('header button[aria-label^="Notificaciones"]');
const panel = (page) => page.locator('section[aria-label="Bandeja de notificaciones"]');
const items = (page) => panel(page).locator('li[data-estado]');

/** Número del contador; 0 si no se muestra (no hay pendientes). */
async function contador(page) {
  const badge = page.locator('[data-testid="contador-no-leidas"]');
  if ((await badge.count()) === 0) return 0;
  return Number(await badge.textContent());
}

async function pendientesEnLista(page) {
  return items(page).and(page.locator('[data-estado="pendiente"]')).count();
}

/** Espera a que la lista termine de cargar (sin «Cargando...»). */
async function listaCargada(page) {
  await esperar(
    async () =>
      (await panel(page).locator('p[role="status"]').count()) === 0 &&
      !(await panel(page).getByRole('button', { name: 'Actualizando...' }).count()),
    'la bandeja terminó de cargar',
  );
}

async function abrir(page) {
  if ((await panel(page).count()) === 0) await campana(page).click();
  await panel(page).waitFor();
  await listaCargada(page);
}

const foto = (page, nombre) =>
  page.screenshot({ path: `${OUT}/${nombre}.png` });

// --- Casos -------------------------------------------------------------------

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const A = await cuenta('arrendador', 'ARRENDADOR');
  const T = await cuenta('arrendatario', 'ARRENDATARIO');
  const X = await cuenta('tercero', 'ARRENDATARIO');
  ({ id: listingId } = await publicar(A));

  // A empieza con 2 pendientes y 1 leída, todas de eventos reales:
  // solicitud R1, solicitud R2 (leída) y «Pago confirmado» del pago de R1.
  const r1 = await solicitud(T);
  const r2 = await solicitud(T);
  await api('PATCH', `/reservas/${r1.id}/decision`, A.token, { decision: 'APROBAR' });
  await api('POST', `/reservas/${r1.id}/pagos/simulados`, T.token, {
    numeroTarjeta: '4242424242424242',
    vencimiento: '12/28',
    cvv: '123',
  });
  const leidaR2 = (await bandejaApi(A)).items.find(
    (i) => i.referencia?.id === r2.id,
  );
  await api('PATCH', `/notificaciones/${leidaR2.id}/leida`, A.token);

  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctxA.newPage();
  vigilar(page, 'A');
  await page.clock.install();
  await entrar(page, A);
  await esperar(async () => (await contador(page)) === 2, 'el contador muestra 2');

  await caso('P01', 'La bandeja distingue pendientes y leídas', async () => {
    await abrir(page);
    const total = await items(page).count();
    const pendientes = items(page).and(page.locator('[data-estado="pendiente"]'));
    const leidas = items(page).and(page.locator('[data-estado="leida"]'));
    comprobar(total === 3, `esperaba 3 avisos, hay ${total}`);
    comprobar((await pendientes.count()) === 2, 'esperaba 2 pendientes');
    comprobar((await leidas.count()) === 1, 'esperaba 1 leída');
    const p = pendientes.first();
    const l = leidas.first();
    comprobar(
      (await p.getByText('Pendiente', { exact: true }).count()) === 1 &&
        (await p.getByRole('button', { name: 'Marcar como leída' }).count()) === 1,
      'la pendiente no dice «Pendiente» o no tiene «Marcar como leída»',
    );
    comprobar(
      (await l.getByText('Leída', { exact: true }).count()) === 1 &&
        (await l.getByRole('button', { name: 'Marcar como leída' }).count()) === 0,
      'la leída no dice «Leída» o conserva el botón',
    );
    const peso = async (li) =>
      li.locator('p').first().evaluate((el) => getComputedStyle(el).fontWeight);
    const fondo = async (li) =>
      li.evaluate((el) => getComputedStyle(el).backgroundColor);
    const opacidad = async (li) => li.evaluate((el) => getComputedStyle(el).opacity);
    const [pp, pl, fp, fl, op, ol] = await Promise.all([
      peso(p), peso(l), fondo(p), fondo(l), opacidad(p), opacidad(l),
    ]);
    comprobar(Number(pp) > Number(pl), `título: pendiente ${pp} vs leída ${pl}`);
    comprobar(fp !== fl, 'el fondo de pendiente y leída es igual');
    comprobar(Number(ol) < Number(op), `opacidad: leída ${ol} vs pendiente ${op}`);
    await foto(page, 'P01-pendientes-y-leidas');
    return `3 avisos: 2 pendientes (título ${pp}, fondo ${fp}) y 1 leída (título ${pl}, opacidad ${ol})`;
  });

  await caso('P02', 'El contador coincide con los pendientes de la bandeja', async () => {
    const badge = await contador(page);
    const enTodas = await pendientesEnLista(page);
    await panel(page).getByRole('button', { name: 'No leídas' }).click();
    await listaCargada(page);
    const enNoLeidas = await items(page).count();
    await panel(page).getByRole('button', { name: 'Todas' }).click();
    await listaCargada(page);
    comprobar(
      badge === enTodas && badge === enNoLeidas,
      `contador ${badge}, pendientes en «Todas» ${enTodas}, en «No leídas» ${enNoLeidas}`,
    );
    return `contador ${badge} = ${enTodas} pendientes en «Todas» = ${enNoLeidas} en «No leídas»`;
  });

  // Desde aquí el tiempo del navegador solo avanza cuando el script lo pide.
  // «Actualizar» reinicia el intervalo de 30 s: así arranca en un instante
  // conocido y los 29 s / 30 s de P03 son exactos.
  await page.clock.pauseAt(Date.now() + 1_000);
  await panel(page).getByRole('button', { name: 'Actualizar' }).click();
  await listaCargada(page);
  await page.keyboard.press('Escape');

  await caso('P03', 'El contador se actualiza solo cada 30 segundos', async () => {
    await solicitud(T); // A: +1 en el backend
    comprobar((await conteoApi(A)) === 3, 'el backend no tiene 3 pendientes');
    await page.clock.runFor(29_000);
    await pausa(1_500);
    const antes = await contador(page);
    await foto(page, 'P03-contador-29s');
    comprobar(antes === 2, `a los 29 s el contador ya cambió: ${antes}`);
    await page.clock.runFor(1_000);
    await esperar(async () => (await contador(page)) === 3, 'a los 30 s el contador muestra 3');
    await foto(page, 'P03-contador-30s');
    return 'a los 29 s sigue en 2; a los 30 s pasa a 3 sin recargar';
  });

  await caso('P04', '«Actualizar» trae los avisos nuevos y refresca el contador', async () => {
    await abrir(page);
    const antes = await items(page).count();
    const nueva = await solicitud(T); // A: +1 en el backend
    await pausa(1_000);
    comprobar((await items(page).count()) === antes, 'la lista cambió sola');
    await panel(page).getByRole('button', { name: 'Actualizar' }).click();
    await listaCargada(page);
    await esperar(async () => (await items(page).count()) === antes + 1, 'aparece el aviso nuevo');
    const primero = items(page).first();
    comprobar(
      (await primero.getAttribute('data-estado')) === 'pendiente' &&
        (await primero.textContent()).includes('Nueva solicitud de reserva'),
      'el primero no es la solicitud nueva pendiente',
    );
    await esperar(async () => (await contador(page)) === 4, 'el contador muestra 4');
    const pend = await pendientesEnLista(page);
    comprobar(pend === 4, `contador 4 pero ${pend} pendientes en la lista`);
    await foto(page, 'P04-actualizar');
    return `antes ${antes} avisos; tras «Actualizar» ${antes + 1}, el nuevo arriba como pendiente (reserva ${nueva.id.slice(0, 8)}); contador 4 = 4 pendientes`;
  });

  let observacionP05 = '';
  await caso('P05', 'Bandeja abierta durante el tick de 30 s (contador vs lista)', async () => {
    await solicitud(T); // A: +1 en el backend → 5
    await page.clock.runFor(30_000);
    await esperar(async () => (await contador(page)) === 5, 'el contador muestra 5');
    await pausa(1_000);
    const badge = await contador(page);
    const pend = await pendientesEnLista(page);
    const total = await items(page).count();
    await foto(page, 'P05-tick-con-bandeja-abierta');
    observacionP05 = `tras el tick, el contador muestra ${badge} y la lista abierta tiene ${pend} pendientes (${total} avisos)`;
    await panel(page).getByRole('button', { name: 'Actualizar' }).click();
    await listaCargada(page);
    await esperar(async () => (await pendientesEnLista(page)) === 5, 'la lista muestra 5 pendientes');
    const despues = `${await contador(page)} / ${await pendientesEnLista(page)}`;
    return `${observacionP05}; tras «Actualizar»: contador / pendientes = ${despues}`;
  });

  let marcadaTexto = '';
  await caso('P06', 'Marcar como leída baja el contador y la conserva en el historial', async () => {
    const total = await items(page).count();
    const antes = await contador(page);
    const objetivo = items(page).and(page.locator('[data-estado="pendiente"]')).first();
    marcadaTexto = (await objetivo.locator('p').nth(1).textContent()) ?? '';
    await objetivo.getByRole('button', { name: 'Marcar como leída' }).click();
    const misma = items(page).filter({ hasText: marcadaTexto });
    await esperar(
      async () => (await misma.getAttribute('data-estado')) === 'leida',
      'el aviso pasa a leída',
    );
    await esperar(async () => (await contador(page)) === antes - 1, 'el contador baja 1');
    comprobar((await items(page).count()) === total, 'el aviso desapareció de la lista');
    comprobar((await misma.getByText('Leída', { exact: true }).count()) === 1, 'no dice «Leída»');
    await foto(page, 'P06-marcada-como-leida');

    // Al recargar sigue leída y en el historial.
    await page.clock.resume();
    await page.reload();
    await esperar(async () => (await contador(page)) === antes - 1, 'el contador tras recargar');
    await abrir(page);
    const tras = items(page).filter({ hasText: marcadaTexto });
    comprobar((await tras.count()) === 1, 'tras recargar ya no está en la bandeja');
    comprobar((await tras.getAttribute('data-estado')) === 'leida', 'tras recargar volvió a pendiente');
    return `contador ${antes} → ${antes - 1}; la lista sigue con ${total} avisos; tras recargar sigue «Leída»`;
  });

  await caso('P07', '«No leídas» y contador en cero', async () => {
    await panel(page).getByRole('button', { name: 'No leídas' }).click();
    await listaCargada(page);
    const n = await items(page).count();
    comprobar(n === (await contador(page)), `«No leídas» ${n} vs contador ${await contador(page)}`);
    comprobar((await items(page).filter({ hasText: marcadaTexto }).count()) === 0, 'la leída aparece en «No leídas»');
    for (let i = 0; i < n; i++) {
      const boton = panel(page).getByRole('button', { name: 'Marcar como leída' }).first();
      await boton.click();
      await esperar(async () => (await contador(page)) === n - i - 1, `contador ${n - i - 1}`);
    }
    comprobar((await page.locator('[data-testid="contador-no-leidas"]').count()) === 0, 'el contador sigue visible en 0');
    await panel(page).getByRole('button', { name: 'Actualizar' }).click();
    await listaCargada(page);
    await esperar(
      async () => (await panel(page).getByText('No tienes notificaciones pendientes.').count()) === 1,
      'mensaje de vacío',
    );
    comprobar((await conteoApi(A)) === 0, 'el backend no quedó en 0');
    await foto(page, 'P07-sin-pendientes');
    return `«No leídas» mostró ${n} = contador; al marcar todas, el contador desaparece y la lista queda vacía`;
  });

  await caso('P08', 'Un tercero no ve ni marca las notificaciones de otro', async () => {
    await solicitud(T); // A: una pendiente nueva
    const deA = (await bandejaApi(A, true)).items[0];
    comprobar(deA, 'A no tiene una pendiente');
    const ctxX = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const px = await ctxX.newPage();
    vigilar(px, 'X');
    await entrar(px, X);
    await pausa(1_000);
    comprobar((await contador(px)) === 0, 'X tiene contador');
    await abrir(px);
    await esperar(async () => (await panel(px).getByText('No tienes notificaciones.').count()) === 1, 'bandeja vacía de X');
    const ids = (await bandejaApi(A)).items.map((i) => i.id);
    const html = await panel(px).innerHTML();
    comprobar(!ids.some((id) => html.includes(id)), 'aparece un id de A');
    // Con la cookie de sesión de X, contra la ruta del frontend. Se usa
    // context.request (no fetch dentro de la página) para que estos 404
    // provocados a propósito no queden en la consola que revisa P10.
    const pedir = async (id) => {
      const r = await ctxX.request.patch(`${FE}/api/notificaciones/${id}/leida`);
      return { status: r.status(), body: await r.text() };
    };
    const ajena = await pedir(deA.id);
    const inexistente = await pedir(randomUUID());
    await foto(px, 'P08-tercero-sin-avisos');
    await ctxX.close();
    comprobar(ajena.status === 404, `ajena respondió ${ajena.status}`);
    comprobar(ajena.body === inexistente.body, `cuerpos distintos: ${ajena.body} / ${inexistente.body}`);
    const sigue = (await bandejaApi(A)).items.find((i) => i.id === deA.id);
    comprobar(sigue?.leidaAt === null, 'la notificación de A quedó marcada');
    return `bandeja de X vacía; PATCH de una de A desde la sesión de X → 404 ${ajena.body}, igual que una inexistente; la de A sigue pendiente`;
  });

  await caso('P09', 'Móvil (375×812): la bandeja entra sin scroll lateral', async () => {
    const ctxM = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
    const pm = await ctxM.newPage();
    vigilar(pm, 'A móvil');
    await entrar(pm, A);
    await esperar(async () => (await contador(pm)) === 1, 'contador 1 en móvil');
    await abrir(pm);
    const ancho = await pm.evaluate(() => document.documentElement.scrollWidth);
    const caja = await panel(pm).boundingBox();
    await foto(pm, 'P09-movil-375');
    await ctxM.close();
    comprobar(ancho <= 375, `scrollWidth ${ancho}`);
    comprobar(caja && caja.x >= 0 && caja.x + caja.width <= 375, 'el panel se sale de la pantalla');
    return `scrollWidth ${ancho}; panel de ${Math.round(caja.width)} px dentro de la pantalla`;
  });

  await caso('P10', 'Sin errores de JavaScript en la consola', async () => {
    comprobar(erroresConsola.length === 0, erroresConsola.join('\n   '));
    return 'ningún error en las sesiones de A, X y móvil';
  });

  await ctxA.close();
} finally {
  await browser.close();
}

const ok = resultados.filter((r) => r.ok).length;
console.log(`\nResultado: ${ok} de ${resultados.length}.`);
process.exitCode = ok === resultados.length ? 0 : 1;
