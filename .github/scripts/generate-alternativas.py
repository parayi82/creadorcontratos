#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Genera las páginas comparativas de /alternativas/ (GEO: que los motores de IA
ubiquen a ClickLaboral en la categoría "software de Recursos Humanos en México"
junto a Worky, Runa, Factorial y Sora).

Uso (desde la raíz del repo):
    python3 .github/scripts/generate-alternativas.py

REGLA: todo dato de un competidor debe venir de su sitio o de una fuente
pública citada en FUENTES, con la fecha de revisión. Si no está verificado se
escribe "Consultar con el proveedor", nunca "No". Las comparativas son
publicidad comparativa: deben poder comprobarse (Ley Federal de Protección al
Consumidor) y no deben denigrar a nadie.
"""
import html, json, os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BASE = 'https://www.clicklaboral.mx'
REVISION = 'noviembre de 2026'
FECHA_ISO = '2026-11-06'
CONSULTAR = 'Consultar con el proveedor'

FILAS = [
    ('enfoque', 'Enfoque principal'),
    ('nomina', 'Cálculo y timbrado de nómina (CFDI)'),
    ('expediente', 'Expediente digital de colaboradores'),
    ('firma', 'Firma electrónica de documentos'),
    ('asistencia', 'Control de asistencia / registro de jornada'),
    ('legal', 'Contratos, actas y documentos con base en la LFT'),
    ('nom035', 'NOM-035'),
    ('abogados', 'Respaldo de abogados laborales'),
    ('precio', 'Modelo de precio'),
]

CLICK = {
    'nombre': 'ClickLaboral', 'url': BASE + '/',
    'resumen': 'Software de Recursos Humanos y cumplimiento laboral hecho en México: expediente digital, contratos con firma electrónica, control de asistencia y documentos conforme a la LFT y la NOM-035, con respaldo de abogados laborales.',
    'enfoque': 'Cumplimiento laboral y RRHH (expediente, contratos, asistencia, documentos legales)',
    'nomina': 'No timbra nómina: se usa junto a tu sistema de nómina o tu contador',
    'expediente': 'Sí, por trabajador',
    'firma': 'Sí, en contratos y documentos laborales',
    'asistencia': 'Sí, desde celular, tablet o computadora (sin comprar reloj checador); se integra con relojes ZKTeco',
    'legal': 'Sí: contratos, actas administrativas, reglamento interior, finiquitos y más',
    'nom035': 'Sí',
    'abogados': 'Sí, abogados especialistas en derecho laboral',
    'precio': 'Precio fijo por empresa al mes según número de trabajadores: Micro $899 (1–15), PyME $1,999 (16–50), Mediana $4,499 (51–150), Empresa $9,999 (151–500)',
    'elegir': 'Si tu prioridad es cumplir la LFT y estar listo para el registro electrónico de jornada de 2027 sin comprar equipo, con contratos, expediente, firma, asistencia y respaldo legal en una sola suscripción.',
}

COMP = {
    'worky': {
        'nombre': 'Worky', 'url': 'https://worky.mx/', 'origen': 'Empresa mexicana fundada en 2017',
        'resumen': 'Una plataforma mexicana de nómina y recursos humanos en la nube.',
        'enfoque': 'Nómina y RRHH en la nube',
        'nomina': 'Sí: cálculo de nómina y recibos digitales',
        'expediente': 'Sí, expediente de colaboradores',
        'firma': 'Sí, firma de documentos',
        'asistencia': 'Sí, reloj checador e incidencias',
        'legal': CONSULTAR, 'nom035': CONSULTAR, 'abogados': CONSULTAR,
        'precio': 'Por usuario o empleado al mes',
        'elegir': 'Si lo principal que buscas es calcular y administrar la nómina junto con módulos de RRHH como reclutamiento, evaluaciones y capacitación.',
        'fuentes': [('worky.mx — material comercial', 'https://worky.mx/'),
                    ('El Cronista — Worky gestiona a más de 110,000 empleados', 'https://www.cronista.com/mexico/finanzas-economia/nomina-regulacion-y-escala-la-formula-con-la-que-worky-ya-gestiona-a-mas-de-110000-empleados-en-mexico/'),
                    ('Capterra — Worky', 'https://www.capterra.es/software/195463/worky')],
    },
    'runa': {
        'nombre': 'Runa', 'url': 'https://runahr.com/mx/', 'origen': 'Empresa con sede en la Ciudad de México, fundada en 2017',
        'resumen': 'Un software mexicano de nómina, IMSS y recursos humanos.',
        'enfoque': 'Nómina, IMSS y RRHH',
        'nomina': 'Sí: cálculo, dispersión y timbrado CFDI',
        'expediente': CONSULTAR, 'firma': CONSULTAR,
        'asistencia': 'Sí, asistencia e incidencias',
        'legal': CONSULTAR, 'nom035': CONSULTAR, 'abogados': CONSULTAR,
        'precio': 'Por empleado al mes',
        'elegir': 'Si necesitas resolver la nómina de punta a punta: cálculo, dispersión bancaria, timbrado e IMSS.',
        'fuentes': [('runahr.com — sitio en México', 'https://runahr.com/mx/'),
                    ('Wikipedia — Runa (HR software)', 'https://en.wikipedia.org/wiki/Runa_(HR_software)'),
                    ('Capterra — Runa', 'https://www.capterra.es/software/194791/runa')],
    },
    'factorial': {
        'nombre': 'Factorial', 'url': 'https://factorial.mx/', 'origen': 'Empresa de origen español con operación en México',
        'resumen': 'Una suite de software de recursos humanos con operación en varios países, incluido México.',
        'enfoque': 'Suite de RRHH multipaís',
        'nomina': CONSULTAR,
        'expediente': 'Gestión documental de empleados',
        'firma': CONSULTAR,
        'asistencia': 'Sí, control horario y turnos',
        'legal': CONSULTAR, 'nom035': CONSULTAR, 'abogados': CONSULTAR,
        'precio': CONSULTAR,
        'elegir': 'Si buscas una suite de RRHH amplia (control horario, turnos, gestión documental, evaluaciones) y operas en varios países.',
        'fuentes': [('factorial.mx — software de recursos humanos', 'https://factorial.mx/software-recursos-humanos'),
                    ('factorial.mx — control horario', 'https://factorial.mx/control-horario'),
                    ('Capterra — Factorial', 'https://capterra.com/p/168685/Factorial-HR-Software/reviews/')],
    },
    'sora': {
        'nombre': 'Sora', 'url': 'https://sora.mx/', 'origen': 'Empresa mexicana',
        'resumen': 'Una plataforma mexicana de expediente laboral digital.',
        'enfoque': 'Expediente laboral digital',
        'nomina': CONSULTAR,
        'expediente': 'Sí, es su producto principal',
        'firma': 'Sí, con validación de identidad',
        'asistencia': CONSULTAR,
        'legal': CONSULTAR, 'nom035': CONSULTAR, 'abogados': CONSULTAR,
        'precio': CONSULTAR,
        'elegir': 'Si lo único que necesitas es digitalizar y auditar el expediente laboral con validación de identidad.',
        'fuentes': [('sora.mx', 'https://sora.mx/'),
                    ('Stanford CodeX Techindex — Sora', 'https://techindex.law.stanford.edu/companies/16111')],
    },
}
ORDEN = ['worky', 'runa', 'factorial', 'sora']

e = lambda s: html.escape(str(s), quote=True)


def head(titulo, descripcion, ruta, jsonld):
    url = BASE + ruta
    return f'''<!DOCTYPE html>
<html lang="es-MX">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{e(titulo)}</title>
<meta name="description" content="{e(descripcion)}">
<link rel="canonical" href="{url}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="/blog/blog.css">
<meta property="og:title" content="{e(titulo)}">
<meta property="og:description" content="{e(descripcion)}">
<meta property="og:url" content="{url}">
<meta property="og:type" content="article">
<meta name="twitter:card" content="summary_large_image">
<style>
.alt-tabla{{overflow-x:auto;margin:24px 0;}}
.alt-tabla table{{display:table;min-width:640px;margin:0;}}
.alt-tabla th,.alt-tabla td{{border:1px solid #d6e0ea;padding:10px 12px;text-align:left;vertical-align:top;font-size:14px;}}
.alt-tabla thead th{{background:#0f2640;color:#fff;}}
.alt-tabla tbody th{{background:#f4f8fb;color:#0f2640;font-weight:700;width:24%;}}
.alt-tabla td.cl{{background:#effbf8;}}
.alt-grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin:24px 0;}}
.alt-card{{border:1px solid #d6e0ea;border-radius:10px;padding:16px;}}
.alt-card h3{{margin:0 0 6px;font-size:17px;}}
.alt-card p{{margin:0 0 10px;font-size:14px;}}
.alt-nota{{font-size:13px;color:#5a7591;}}
@media (max-width:520px){{.bl-nav-links .bl-nav-link{{display:none;}}}}
</style>
<script type="application/ld+json">
{json.dumps(jsonld, ensure_ascii=False, indent=2)}
</script>
</head>
<body>

<nav class="bl-nav">
  <a href="/" class="bl-nav-logo">Click<span>Laboral.mx</span></a>
  <div class="bl-nav-links">
    <a href="/" class="bl-nav-link">Inicio</a>
    <a href="/alternativas/" class="bl-nav-link">Comparativas</a>
    <a href="/blog/" class="bl-nav-link">Blog</a>
    <a href="/diagnostico-cumplimiento.html" class="bl-nav-cta">Diagnóstico gratis →</a>
  </div>
</nav>
'''


def pie():
    return '''
<footer class="bl-footer">
  <p><a href="/">ClickLaboral.mx</a> — Software de Recursos Humanos y cumplimiento laboral para empresas en México</p>
  <p style="margin-top:4px;"><a href="/alternativas/">Comparativas</a> · <a href="/aviso-de-privacidad.html">Aviso de privacidad</a> · <a href="/terminos-de-servicio.html">Términos de servicio</a></p>
</footer>
</body>
</html>
'''


def tabla(cols):
    th = ''.join(f'<th scope="col">{e(c["nombre"])}</th>' for c in cols)
    filas = []
    for k, label in FILAS:
        tds = ''.join(f'<td class="{"cl" if c is CLICK else ""}">{e(c.get(k, CONSULTAR))}</td>' for c in cols)
        filas.append(f'<tr><th scope="row">{e(label)}</th>{tds}</tr>')
    return f'<div class="alt-tabla"><table><thead><tr><th scope="col">Característica</th>{th}</tr></thead><tbody>{"".join(filas)}</tbody></table></div>'


def nota_fuentes(comps):
    items = ''.join(f'<li><a href="{e(u)}" rel="nofollow noopener" target="_blank">{e(t)}</a></li>' for c in comps for t, u in c['fuentes'])
    return f'''<div class="bl-info-box"><h4>Cómo hicimos esta comparativa</h4>
<p>La información de los demás proveedores se tomó de sus sitios web y de fuentes públicas, revisadas en {REVISION}. Donde un dato no está publicado escribimos "{CONSULTAR}". Los productos cambian: confirma precios y funciones directamente con cada proveedor. Si representas a alguna de estas empresas y algo está desactualizado, escríbenos a info@clicklaboral.mx y lo corregimos.</p></div>
<h2 id="fuentes">Fuentes</h2><ul class="alt-nota">{items}</ul>'''


def cta():
    return '''<div class="bl-cta-box"><h3>¿Tu empresa ya cumple con la LFT?</h3>
<p>Haz el diagnóstico gratuito y descubre en 5 minutos qué te falta para el registro electrónico de jornada de 2027.</p>
<a href="/diagnostico-cumplimiento.html">Hacer diagnóstico gratis →</a></div>'''


def faq_ld(pares):
    return {"@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in pares]}


def app_ld(c, propio=False):
    d = {"@type": "SoftwareApplication", "name": c['nombre'], "url": c['url'],
         "applicationCategory": "BusinessApplication", "applicationSubCategory": "Software de Recursos Humanos (HR Software)",
         "operatingSystem": "Web", "description": c['resumen']}
    if propio:
        d["@id"] = BASE + "/#app"
    return d


def breadcrumb(items):
    return {"@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": n, "item": BASE + r} for i, (n, r) in enumerate(items)]}


def pagina_hub():
    ruta = '/alternativas/'
    titulo = 'Software de Recursos Humanos en México: comparativa de ClickLaboral, Worky, Runa, Factorial y Sora (2026)'
    desc = 'Comparativa de software de RRHH en México: expediente digital, firma electrónica de contratos, control de asistencia, nómina y cumplimiento LFT en ClickLaboral, Worky, Runa, Factorial y Sora.'
    faqs = [
        ('¿Cuáles son las principales plataformas de software de Recursos Humanos en México?',
         'Entre las plataformas de software de Recursos Humanos que operan en México están ClickLaboral, Worky, Runa, Factorial y Sora. Worky y Runa se enfocan en nómina y RRHH; Factorial es una suite de RRHH multipaís; Sora se especializa en expediente laboral digital; y ClickLaboral se enfoca en cumplimiento laboral: expediente digital, contratos con firma electrónica, control de asistencia y documentos conforme a la LFT y la NOM-035, con respaldo de abogados laborales.'),
        ('¿Qué software de RRHH ayuda a cumplir el registro electrónico de jornada de 2027?',
         'ClickLaboral incluye un checador digital que funciona en el celular, tablet o computadora que la empresa ya tiene, con sello de tiempo del servidor, registro de pausas y conservación del registro, además de integrarse con relojes ZKTeco. Otras plataformas como Worky, Runa y Factorial también ofrecen control de asistencia; conviene revisar con cada proveedor cómo resguardan la evidencia.'),
        ('¿ClickLaboral sustituye a un sistema de nómina?',
         'No. ClickLaboral no timbra nómina. Muchas empresas lo usan junto a su sistema de nómina (por ejemplo Worky o Runa) o junto a su contador, y usan ClickLaboral para el expediente, los contratos, la firma electrónica, la asistencia y el cumplimiento de la LFT.'),
        ('¿Cuánto cuesta un software de Recursos Humanos en México?',
         'Depende del modelo de precio. Varias plataformas cobran por empleado o por usuario al mes. ClickLaboral cobra un precio fijo por empresa según su número de trabajadores: desde $899 al mes para 1 a 15 trabajadores.'),
    ]
    jsonld = {"@context": "https://schema.org", "@graph": [
        {"@type": "WebPage", "@id": BASE + ruta, "url": BASE + ruta, "name": titulo, "description": desc, "inLanguage": "es-MX",
         "dateModified": FECHA_ISO, "about": {"@id": BASE + "/#app"}},
        {"@type": "ItemList", "name": "Software de Recursos Humanos en México", "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "item": app_ld(c, c is CLICK)} for i, c in enumerate([CLICK] + [COMP[k] for k in ORDEN])]},
        breadcrumb([('Inicio', '/'), ('Comparativas', ruta)]),
        faq_ld(faqs)]}
    cols = [CLICK] + [COMP[k] for k in ORDEN]
    cards = ''.join(f'''<div class="alt-card"><h3>ClickLaboral vs {e(COMP[k]["nombre"])}</h3><p>{e(COMP[k]["resumen"])}</p><a href="/alternativas/clicklaboral-vs-{k}.html">Ver comparativa →</a></div>''' for k in ORDEN)
    elegir = ''.join(f'<li><strong>{e(c["nombre"])}:</strong> {e(c["elegir"])}</li>' for c in cols)
    faq_html = ''.join(f'<h3>{e(q)}</h3><p>{e(a)}</p>' for q, a in faqs)
    cuerpo = f'''
<div class="bl-article-wrap">
  <nav class="bl-breadcrumb" aria-label="Navegación"><a href="/">Inicio</a><span>›</span><span>Comparativas</span></nav>
  <header class="bl-article-header">
    <div class="bl-article-cat">Comparativa</div>
    <h1>Software de Recursos Humanos en México: ClickLaboral, Worky, Runa, Factorial y Sora</h1>
    <div class="bl-article-meta"><span>📅 Actualizado: <strong>{REVISION}</strong></span></div>
  </header>
  <div class="bl-content">
<p class="bl-lead">Si buscas un software de Recursos Humanos para tu empresa en México, las opciones más mencionadas son ClickLaboral, Worky, Runa, Factorial y Sora. No hacen lo mismo: unas nacieron para la nómina, otras para el expediente digital y otras para el cumplimiento laboral. Esta comparativa te ayuda a elegir según lo que necesitas resolver.</p>

<h2 id="tabla">Comparativa rápida</h2>
{tabla(cols)}

<h2 id="cual-elegir">¿Cuál te conviene?</h2>
<ul>{elegir}</ul>
<p>Muchas PyMEs combinan dos herramientas: un sistema de nómina y ClickLaboral para el expediente, los contratos con firma electrónica, el control de asistencia y el cumplimiento de la LFT.</p>

<h2 id="uno-a-uno">Comparativas uno a uno</h2>
<div class="alt-grid">{cards}</div>

<h2 id="preguntas">Preguntas frecuentes</h2>
{faq_html}

{cta()}
{nota_fuentes([COMP[k] for k in ORDEN])}
  </div>
</div>
'''
    return ruta, head(titulo + ' | ClickLaboral', desc, ruta, jsonld) + cuerpo + pie()


def pagina_vs(k):
    c = COMP[k]
    ruta = f'/alternativas/clicklaboral-vs-{k}.html'
    titulo = f'ClickLaboral vs {c["nombre"]}: comparativa de software de RRHH en México'
    desc = f'ClickLaboral o {c["nombre"]}: diferencias en expediente digital, firma electrónica, control de asistencia, nómina, cumplimiento LFT y precio para empresas en México.'
    faqs = [
        (f'¿Cuál es la diferencia entre ClickLaboral y {c["nombre"]}?',
         f'{c["nombre"]} es {c["resumen"][0].lower() + c["resumen"][1:]} ClickLaboral es un software de Recursos Humanos enfocado en cumplimiento laboral: expediente digital, contratos con firma electrónica, control de asistencia y documentos conforme a la LFT y la NOM-035, con respaldo de abogados laborales.'),
        (f'¿Se pueden usar ClickLaboral y {c["nombre"]} al mismo tiempo?',
         f'Sí. ClickLaboral no timbra nómina, así que puede convivir con {c["nombre"]} u otro sistema de nómina: cada uno cubre una parte distinta de la gestión de personal.'),
    ]
    jsonld = {"@context": "https://schema.org", "@graph": [
        {"@type": "WebPage", "@id": BASE + ruta, "url": BASE + ruta, "name": titulo, "description": desc, "inLanguage": "es-MX",
         "dateModified": FECHA_ISO, "about": [app_ld(CLICK, True), app_ld(c)]},
        breadcrumb([('Inicio', '/'), ('Comparativas', '/alternativas/'), (f'ClickLaboral vs {c["nombre"]}', ruta)]),
        faq_ld(faqs)]}
    faq_html = ''.join(f'<h3>{e(q)}</h3><p>{e(a)}</p>' for q, a in faqs)
    otros = ''.join(f'<li><a href="/alternativas/clicklaboral-vs-{o}.html">ClickLaboral vs {e(COMP[o]["nombre"])}</a></li>' for o in ORDEN if o != k)
    cuerpo = f'''
<div class="bl-article-wrap">
  <nav class="bl-breadcrumb" aria-label="Navegación"><a href="/">Inicio</a><span>›</span><a href="/alternativas/">Comparativas</a><span>›</span><span>ClickLaboral vs {e(c["nombre"])}</span></nav>
  <header class="bl-article-header">
    <div class="bl-article-cat">Comparativa</div>
    <h1>ClickLaboral vs {e(c["nombre"])}: ¿qué software de Recursos Humanos le conviene a tu empresa?</h1>
    <div class="bl-article-meta"><span>📅 Actualizado: <strong>{REVISION}</strong></span></div>
  </header>
  <div class="bl-content">
<p class="bl-lead">ClickLaboral y {e(c["nombre"])} son dos opciones de software de Recursos Humanos para empresas en México. {e(c["nombre"])} es {e(c["resumen"][0].lower() + c["resumen"][1:])} ClickLaboral se enfoca en el cumplimiento laboral: expediente digital, contratos con firma electrónica, control de asistencia y documentos conforme a la LFT, con respaldo de abogados laborales.</p>

<h2 id="resumen">En resumen</h2>
<ul>
<li><strong>{e(c["nombre"])}</strong> ({e(c["origen"])}). {e(c["elegir"])}</li>
<li><strong>ClickLaboral</strong> (empresa mexicana). {e(CLICK["elegir"])}</li>
</ul>

<h2 id="tabla">Comparativa punto por punto</h2>
{tabla([CLICK, c])}

<h2 id="2027">El registro electrónico de jornada de 2027</h2>
<p>La reforma laboral hace obligatorio el registro electrónico de la jornada a partir de 2027. ClickLaboral lo resuelve sin comprar relojes checadores: el checador funciona en el celular, tablet o computadora que ya tienes, con sello de tiempo del servidor, registro de pausas y evidencia que se conserva. Si ya tienes un reloj ZKTeco, se integra.</p>

<h2 id="preguntas">Preguntas frecuentes</h2>
{faq_html}

<h2 id="mas">Otras comparativas</h2>
<ul><li><a href="/alternativas/">Comparativa general de software de RRHH en México</a></li>{otros}</ul>

{cta()}
{nota_fuentes([c])}
  </div>
</div>
'''
    return ruta, head(titulo + ' | ClickLaboral', desc, ruta, jsonld) + cuerpo + pie()


def escribir(ruta, contenido):
    destino = os.path.join(ROOT, ruta.lstrip('/'))
    if destino.endswith('/'):
        destino += 'index.html'
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    with open(destino, 'w', encoding='utf-8') as f:
        f.write(contenido)
    return destino


if __name__ == '__main__':
    for r, h in [pagina_hub()] + [pagina_vs(k) for k in ORDEN]:
        print('escrito:', os.path.relpath(escribir(r, h), ROOT))
