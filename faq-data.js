// ════════════════════════════════════════════════════════
// BASE DE CONOCIMIENTO LEGAL — sin IA, 100% respuestas fijas
// ClickLaboral.mx
// ════════════════════════════════════════════════════════
const FAQ_DATA = [

  // ══════════ CONTRATOS ══════════
  {
    cat: 'contratos',
    q: '¿Qué elementos debe tener un contrato individual de trabajo?',
    a: `<p>Conforme al <span class="faq-art">Art. 25 LFT</span>, todo contrato individual de trabajo debe contener al menos:</p>
    <p>Nombre, nacionalidad, edad, sexo, estado civil, CURP, RFC y domicilio del trabajador y del patrón; si la relación es por tiempo indeterminado, por obra, por temporada, por tiempo determinado o sujeta a prueba o capacitación inicial; el servicio o servicios a prestar; lugar de trabajo; duración de la jornada; salario y forma/lugar/periodicidad de pago; día de descanso semanal y vacaciones; y demás condiciones de trabajo (capacitación, adiestramiento, etc.).</p>
    <p><strong>Recomendación:</strong> use siempre nuestro generador de contratos — ya integra todos estos elementos obligatorios según la modalidad que seleccione.</p>`
  },
  {
    cat: 'contratos',
    q: '¿Cuál es la diferencia entre contrato determinado e indeterminado?',
    a: `<p>El contrato por <strong>tiempo indeterminado</strong> es la regla general en la LFT (<span class="faq-art">Art. 35</span>) — no tiene fecha de término y subsiste hasta que alguna causa legal lo termine.</p>
    <p>El contrato por <strong>tiempo determinado</strong> solo es válido cuando existe una causa objetiva que lo justifique: obra o servicio determinado, sustitución temporal de otro trabajador, o naturaleza temporal del trabajo (<span class="faq-art">Art. 36 LFT</span>). Si no se acredita esa causa, la ley presume que el contrato es por tiempo indeterminado.</p>
    <p><strong>Importante:</strong> un contrato determinado mal justificado es altamente vulnerable en una demanda laboral — el trabajador puede reclamar que en realidad era indeterminado.</p>`
  },
  {
    cat: 'contratos',
    q: '¿Cuánto puede durar el período a prueba?',
    a: `<p>Conforme al <span class="faq-art">Art. 39-A LFT</span>:</p>
    <p>• <strong>30 días</strong> como máximo para trabajadores en general.<br>
    • <strong>180 días</strong> como máximo para puestos de dirección, gerenciales, y para trabajos que requieran conocimientos profesionales especializados.</p>
    <p>El período a prueba solo puede pactarse <strong>una vez</strong> entre las mismas partes para el mismo puesto, y no puede combinarse con el período de capacitación inicial.</p>`
  },
  {
    cat: 'contratos',
    q: '¿Cuánto puede durar el período de capacitación inicial?',
    a: `<p>Conforme al <span class="faq-art">Art. 39-B LFT</span>:</p>
    <p>• <strong>3 meses</strong> como máximo para trabajadores en general.<br>
    • <strong>6 meses</strong> como máximo para puestos de dirección, gerenciales, y trabajos especializados.</p>
    <p>Igual que el período a prueba, solo se puede pactar una vez por trabajador y por puesto, y no es acumulable con el período a prueba del artículo 39-A.</p>`
  },
  {
    cat: 'contratos',
    q: '¿Qué es un contrato de comisionista y cómo se calcula el salario integrado?',
    a: `<p>El comisionista (<span class="faq-art">Arts. 285-289 LFT</span>) es un trabajador subordinado cuya remuneración consiste total o parcialmente en una comisión por las operaciones en que interviene. <strong>Sí existe relación laboral</strong> y debe estar inscrito al IMSS desde el primer día.</p>
    <p>Para efectos de prestaciones (aguinaldo, vacaciones, etc.), el salario base se integra con el <strong>promedio de comisiones</strong> percibidas en un período representativo, conforme al artículo 84 LFT — no solo el sueldo base si lo hay.</p>
    <p><strong>Cuidado:</strong> no confundir con un agente comercial independiente (relación mercantil, sin subordinación) — la diferencia determina si hay o no relación laboral.</p>`
  },
  {
    cat: 'contratos',
    q: '¿Qué son los "asimilados a salarios" y cuándo se usan?',
    a: `<p>Es una figura <strong>fiscal, no laboral</strong> (<span class="faq-art">Art. 94 LISR</span>). Aplica a directivos, gerentes, administradores, consejeros, comisarios y socios/accionistas que prestan servicios a la persona moral de la que son socios.</p>
    <p><strong>Punto crítico:</strong> esta modalidad NO genera relación laboral bajo la LFT — no hay IMSS, no hay prestaciones laborales, no hay subordinación reconocida. El pagador solo retiene ISR como si fueran salarios, para efectos fiscales.</p>
    <p>Usar esta figura para evadir obligaciones laborales reales (cuando sí existe subordinación) es un riesgo serio de simulación laboral ante una autoridad o demanda.</p>`
  },
  {
    cat: 'contratos',
    q: '¿Es necesario el REPSE para subcontratar personal?',
    a: `<p>Sí. Conforme al <span class="faq-art">Art. 13 LFT</span>, toda empresa que presta <strong>servicios especializados u obras especializadas</strong> a otra empresa debe estar inscrita en el Registro de Prestadoras de Servicios Especializados u Obras Especializadas (REPSE) ante la STPS.</p>
    <p>Sin este registro vigente, el contrato de servicios especializados <strong>no surte efectos frente a terceros</strong>, y la empresa contratante puede ser considerada patrón solidario o sustituto de los trabajadores.</p>`
  },

  // ══════════ RESCISIÓN Y DESPIDO ══════════
  {
    cat: 'rescision',
    q: '¿Cuándo procede una rescisión sin responsabilidad para el patrón?',
    a: `<p>El <span class="faq-art">Art. 47 LFT</span> establece 14 causales, entre las más comunes:</p>
    <p>• Engañar al trabajador con certificados o referencias falsas (fracc. I)<br>
    • Incurrir en faltas de probidad, violencia o malos tratos contra el patrón o compañeros (fracc. II y III)<br>
    • Causar daños materiales intencionales o por descuido grave (fracc. V y VI)<br>
    • Tener más de 3 faltas de asistencia injustificadas en 30 días (fracc. IX)<br>
    • Desobedecer instrucciones sin causa justificada (fracc. X)<br>
    • Presentarse en estado de embriaguez o bajo influjo de drogas (fracc. XII)</p>
    <p><strong>Plazo crítico:</strong> el patrón tiene <strong>30 días naturales</strong> a partir de que tuvo conocimiento de la causa para notificar la rescisión por escrito (<span class="faq-art">Art. 517 LFT</span>). Pasado ese plazo, la acción prescribe.</p>`
  },
  {
    cat: 'rescision',
    q: '¿Qué pasa si despido a un trabajador sin causa justificada?',
    a: `<p>Si el despido es injustificado, el trabajador puede elegir entre (<span class="faq-art">Art. 48 LFT</span>):</p>
    <p>• <strong>Reinstalación</strong> en su puesto, con el pago de salarios vencidos desde la fecha del despido hasta que se cumpla la sentencia (con tope de 12 meses para el cálculo de salarios vencidos).<br>
    • <strong>Indemnización constitucional de 90 días</strong> de salario, más las prestaciones que correspondan según su antigüedad.</p>
    <p>Vea la sección de Liquidación y Finiquito para el desglose completo del cálculo.</p>`
  },
  {
    cat: 'rescision',
    q: '¿Cómo notifico correctamente una rescisión por escrito?',
    a: `<p>El aviso de rescisión debe (<span class="faq-art">Art. 47, último párrafo, LFT</span>):</p>
    <p>• Hacerse <strong>por escrito</strong>, especificando la(s) conducta(s) y la(s) fecha(s) en que se cometieron.<br>
    • Entregarse directamente al trabajador, o notificarse al Tribunal Laboral competente dentro de los 5 días hábiles siguientes si el trabajador se niega a recibirlo o no se le puede localizar.<br>
    • La falta de aviso, por sí sola, basta para considerar el despido como injustificado, sin importar que la causa haya sido real.</p>
    <p>Use nuestro generador de Acta de Rescisión — incluye la estructura legal correcta y las 14 causales del artículo 47.</p>`
  },
  {
    cat: 'rescision',
    q: '¿Puedo despedir a una trabajadora embarazada o en período de lactancia?',
    a: `<p>No por esa condición. El embarazo, la maternidad y la lactancia son categorías protegidas — un despido motivado por esas condiciones se considera <strong>discriminatorio</strong> y nulo.</p>
    <p>Si existe una causa real y verificable del artículo 47 LFT (ajena al embarazo), sí puede proceder la rescisión, pero el patrón debe estar especialmente preparado para acreditar que la causa es genuina y no un pretexto, dado el riesgo reputacional y legal que implica.</p>
    <p><strong>Recomendación:</strong> ante cualquier situación con trabajadoras embarazadas, contacte a su abogado antes de tomar cualquier acción — es un área de alto riesgo legal.</p>`
  },
  {
    cat: 'rescision',
    q: '¿Qué diferencia hay entre rescisión y terminación de la relación laboral?',
    a: `<p>La <strong>rescisión</strong> (Art. 47 LFT) es la terminación por una causa imputable a una de las partes (falta grave del trabajador, o incumplimiento grave del patrón vía el Art. 51).</p>
    <p>La <strong>terminación</strong> (Art. 53 LFT) ocurre por causas ajenas a la voluntad o conducta de las partes: mutuo consentimiento, muerte del trabajador, conclusión de la obra o vencimiento del plazo en contratos determinados, incapacidad física o mental del trabajador, o casos fortuitos/fuerza mayor.</p>
    <p>El tratamiento de indemnizaciones es distinto en cada caso — siempre identifique correctamente cuál aplica antes de actuar.</p>`
  },

  // ══════════ LIQUIDACIÓN Y FINIQUITO ══════════
  {
    cat: 'liquidacion',
    q: '¿Cuál es la diferencia entre finiquito y liquidación?',
    a: `<p><strong>Finiquito:</strong> se paga cuando la relación termina por causas que NO generan responsabilidad para el patrón (renuncia voluntaria, mutuo acuerdo, fin de contrato determinado). Incluye solo las partes proporcionales: aguinaldo, vacaciones, prima vacacional, y salarios pendientes.</p>
    <p><strong>Liquidación:</strong> se paga cuando hay despido injustificado o rescisión injustificada del patrón. Además del finiquito, incluye la <strong>indemnización constitucional de 90 días</strong> (<span class="faq-art">Art. 50 LFT</span>) y, en su caso, la <strong>prima de antigüedad</strong> (<span class="faq-art">Art. 162 LFT</span>).</p>`
  },
  {
    cat: 'liquidacion',
    q: 'Calculadora: ¿cómo se calcula la indemnización constitucional de 90 días?',
    a: `<p>Conforme al <span class="faq-art">Art. 50, fracc. I, LFT</span>, la indemnización constitucional equivale a <strong>90 días de salario</strong> (salario diario, no integrado), independientemente de la antigüedad del trabajador.</p>
    <div class="calc-inline">
      <div class="calc-inline-title">🧮 Calculadora rápida — Indemnización 90 días</div>
      <div class="calc-row">
        <label>Salario diario (MXN)</label>
        <input type="number" id="calc-ind90-salario" placeholder="0.00" oninput="calcIndemnizacion90()">
      </div>
      <div class="calc-result-box" id="calc-ind90-resultado" style="display:none;">
        <div class="calc-result-row"><span>90 días × salario diario</span><span id="calc-ind90-total">$0.00</span></div>
      </div>
    </div>
    <p>Esta indemnización se suma a las partes proporcionales (aguinaldo, vacaciones, prima vacacional) y, si aplica, a la prima de antigüedad.</p>`
  },
  {
    cat: 'liquidacion',
    q: 'Calculadora: ¿cómo se calcula la prima de antigüedad?',
    a: `<p>Conforme al <span class="faq-art">Art. 162 LFT</span>, la prima de antigüedad equivale a <strong>12 días de salario por cada año de servicios</strong>.</p>
    <p><strong>Tope legal:</strong> el salario base para este cálculo no puede exceder de <strong>2 veces el Salario Mínimo General (SMG)</strong> vigente en el área geográfica, aunque el trabajador gane más.</p>
    <p><strong>¿Cuándo se paga?</strong> Siempre que termine la relación laboral después de 15 años de servicio (independientemente de la causa), y también en caso de despido injustificado, muerte o incapacidad, sin importar la antigüedad.</p>
    <div class="calc-inline">
      <div class="calc-inline-title">🧮 Calculadora rápida — Prima de antigüedad</div>
      <div class="calc-row">
        <label>Salario diario (MXN)</label>
        <input type="number" id="calc-prima-salario" placeholder="0.00" oninput="calcPrimaAntiguedad()">
      </div>
      <div class="calc-row">
        <label>Años de antigüedad</label>
        <input type="number" id="calc-prima-anios" placeholder="0" step="0.1" oninput="calcPrimaAntiguedad()">
      </div>
      <div class="calc-result-box" id="calc-prima-resultado" style="display:none;">
        <div class="calc-result-row"><span>Salario aplicado (con tope 2×SMG)</span><span id="calc-prima-salario-aplicado">$0.00</span></div>
        <div class="calc-result-row"><span>12 días × años × salario tope</span><span id="calc-prima-total">$0.00</span></div>
      </div>
    </div>
    <p style="font-size:11px;color:var(--ink3);">SMG de referencia: $278.80 MXN/día (verifique el vigente al momento del cálculo).</p>`
  },
  {
    cat: 'liquidacion',
    q: '¿Cómo se calcula el aguinaldo proporcional?',
    a: `<p>Conforme al <span class="faq-art">Art. 87 LFT</span>, el aguinaldo es de <strong>15 días de salario como mínimo</strong>, pagadero antes del 20 de diciembre de cada año.</p>
    <p>Si el trabajador no laboró el año completo, se paga la <strong>parte proporcional</strong>:</p>
    <p style="text-align:center;font-family:monospace;background:var(--surface);padding:10px;border-radius:6px;">Aguinaldo proporcional = (15 días ÷ 365) × días trabajados en el año × salario diario</p>
    <p>Ejemplo: un trabajador con 90 días laborados en el año y salario de $300/día → (15÷365) × 90 × $300 = <strong>$1,109.59 MXN</strong> aproximadamente.</p>`
  },
  {
    cat: 'liquidacion',
    q: '¿Cómo se calculan las vacaciones y la prima vacacional proporcional?',
    a: `<p><strong>Vacaciones</strong> (<span class="faq-art">Art. 76 LFT</span>): mínimo 12 días en el primer año, incrementando 2 días por cada año subsecuente hasta el cuarto año, luego 2 días adicionales por cada 5 años de servicio.</p>
    <p><strong>Prima vacacional</strong> (<span class="faq-art">Art. 80 LFT</span>): mínimo 25% sobre el salario correspondiente a los días de vacaciones.</p>
    <p>Si el trabajador no cumplió el año completo, ambos conceptos se pagan de forma <strong>proporcional</strong> al tiempo laborado, usando la misma lógica de proporción que el aguinaldo.</p>`
  },
  {
    cat: 'liquidacion',
    q: '¿Qué es el salario integrado y por qué afecta los cálculos de liquidación?',
    a: `<p>El <strong>Salario Diario Integrado (SDI)</strong> (<span class="faq-art">Art. 84 LFT</span>) incluye, además del salario base, todas las prestaciones que recibe el trabajador de forma regular: comisiones, gratificaciones, percepciones, habitación, primas, prestaciones en especie, y cualquier otra cantidad entregada por su trabajo.</p>
    <p>El SDI se usa principalmente para cuotas IMSS y para cálculos donde la ley exige "salario integrado" explícitamente. Para la indemnización de 90 días y los 20 días por año (en despido injustificado), normalmente se usa salario integrado si así se acredita en el cálculo, no solo el salario base nominal — verifique esto con su abogado caso por caso, ya que es un punto frecuente de litigio.</p>`
  },
  {
    cat: 'liquidacion',
    q: '¿Qué pasa con la liquidación si el trabajador renuncia voluntariamente?',
    a: `<p>En una renuncia voluntaria, el trabajador <strong>NO tiene derecho</strong> a indemnización constitucional ni a los 20 días por año.</p>
    <p>Sí tiene derecho a:</p>
    <p>• Salarios devengados y no pagados<br>
    • Aguinaldo proporcional<br>
    • Vacaciones y prima vacacional proporcionales<br>
    • <strong>Prima de antigüedad</strong> únicamente si acumuló 15 años o más de servicio (<span class="faq-art">Art. 162 LFT</span>)</p>
    <p>Esto es lo que se conoce como "finiquito" — revise la pregunta sobre finiquito vs. liquidación.</p>`
  },

  // ══════════ JORNADA Y DESCANSOS ══════════
  {
    cat: 'jornada',
    q: '¿Cuáles son los límites legales de la jornada de trabajo?',
    a: `<p>Conforme a los <span class="faq-art">Arts. 60-61 LFT</span>:</p>
    <p>• <strong>Diurna:</strong> máximo 8 horas (entre 6:00 y 20:00 hrs)<br>
    • <strong>Nocturna:</strong> máximo 7 horas (entre 20:00 y 6:00 hrs)<br>
    • <strong>Mixta:</strong> máximo 7.5 horas (combina periodos diurno y nocturno, sin que el nocturno exceda 3.5 horas)</p>
    <p>Estos son límites máximos legales — pueden pactarse jornadas reducidas, pero nunca jornadas que excedan estos topes.</p>`
  },
  {
    cat: 'jornada',
    q: '¿Cómo se paga el tiempo extraordinario (horas extra)?',
    a: `<p>Conforme al <span class="faq-art">Art. 67 LFT</span>:</p>
    <p>• Las primeras <strong>9 horas extras a la semana</strong> se pagan al <strong>doble</strong> del salario que corresponda a las horas de la jornada.<br>
    • A partir de la <strong>10ª hora extra semanal</strong>, el pago es al <strong>triple</strong>.</p>
    <p>El trabajo extraordinario que exceda 9 horas a la semana es ilegal y puede ser sancionado, aunque se pague — la ley busca prevenir la sobreexplotación, no solo compensarla económicamente.</p>`
  },
  {
    cat: 'jornada',
    q: '¿Qué dice la LFT sobre trabajar en el día de descanso?',
    a: `<p>Conforme al <span class="faq-art">Art. 73 LFT</span>, si un trabajador labora en su día de descanso semanal, tiene derecho a un <strong>salario doble</strong> además del salario que le corresponda por el descanso (es decir, recibe triple en total ese día).</p>
    <p>Adicionalmente, si labora en domingo (sea o no su día de descanso oficial), tiene derecho a una <strong>prima dominical del 25%</strong> sobre su salario ordinario (<span class="faq-art">Art. 71 LFT</span>).</p>`
  },
  {
    cat: 'jornada',
    q: '¿Cuáles son los días de descanso obligatorio en México?',
    a: `<p>Conforme al <span class="faq-art">Art. 74 LFT</span>, son días de descanso obligatorio:</p>
    <p>• 1 de enero<br>
    • Primer lunes de febrero (conmemoración del 5 de febrero)<br>
    • Tercer lunes de marzo (conmemoración del 21 de marzo)<br>
    • 1 de mayo<br>
    • 16 de septiembre<br>
    • Tercer lunes de noviembre (conmemoración del 20 de noviembre)<br>
    • 1 de diciembre cada 6 años (transmisión del Poder Ejecutivo Federal)<br>
    • 25 de diciembre<br>
    • El que determinen las leyes electorales federal y locales, en el caso de elecciones ordinarias</p>`
  },
  {
    cat: 'jornada',
    q: '¿Es obligatorio dar tiempo para tomar alimentos durante la jornada?',
    a: `<p>Sí. El <span class="faq-art">Art. 63 LFT</span> establece que durante la jornada continua de trabajo se debe conceder al trabajador un descanso de <strong>al menos media hora</strong>.</p>
    <p>Este tiempo no se computa como parte de la jornada de trabajo, salvo que el trabajador no pueda salir del lugar de trabajo o disponer libremente de ese tiempo — en cuyo caso sí podría considerarse tiempo trabajado.</p>`
  },

  // ══════════ SALARIO Y PRESTACIONES ══════════
  {
    cat: 'salario',
    q: '¿Qué descuentos puede hacer el patrón al salario del trabajador?',
    a: `<p>Conforme al <span class="faq-art">Art. 110 LFT</span>, solo se permiten descuentos en estos casos:</p>
    <p>• Pago de deudas con el patrón por anticipos de salario (no más del 30% del excedente sobre el SMG)<br>
    • Pago de renta cuando el patrón proporciona habitación<br>
    • Pago de abonos para cubrir préstamos del INFONAVIT o créditos sindicales<br>
    • Pago de cuotas sindicales y de cooperativas<br>
    • Pago de pensiones alimenticias decretadas por autoridad<br>
    • Reparación de daños causados por el trabajador con dolo o negligencia grave, siempre acreditados</p>
    <p>Cualquier otro descuento sin fundamento legal o sin consentimiento expreso del trabajador es ilegal.</p>`
  },
  {
    cat: 'salario',
    q: '¿Cómo y cuándo debe pagarse el salario?',
    a: `<p>El <span class="faq-art">Art. 108 LFT</span> exige que el salario se pague en moneda de curso legal (o vía transferencia/depósito), directamente al trabajador, en el lugar donde presta sus servicios o en lugar que no le cause perjuicio.</p>
    <p>La periodicidad máxima permitida es:</p>
    <p>• Trabajadores en general: <strong>cada semana</strong> como máximo<br>
    • Trabajo no manual (administrativos, etc.): <strong>cada 15 días</strong> como máximo</p>`
  },
  {
    cat: 'salario',
    q: '¿Qué es el PTU y cómo se calcula?',
    a: `<p>La Participación de los Trabajadores en las Utilidades (PTU) es un derecho constitucional (<span class="faq-art">Art. 123 CPEUM</span>, regulado en <span class="faq-art">Art. 117-131 LFT</span>): el 10% de las utilidades fiscales de la empresa se reparte entre los trabajadores.</p>
    <p><strong>Plazo de pago:</strong> dentro de los 60 días siguientes a la fecha en que deba pagarse el impuesto anual (normalmente mayo para personas morales).</p>
    <p>Se requiere una <strong>Comisión Mixta para la determinación de PTU</strong>, integrada de forma paritaria entre trabajadores y patrón.</p>`
  },
  {
    cat: 'salario',
    q: '¿Qué prestaciones mínimas debe tener todo trabajador?',
    a: `<p>Como mínimo de ley, todo trabajador tiene derecho a:</p>
    <p>• Vacaciones (mín. 12 días el primer año) + prima vacacional (mín. 25%)<br>
    • Aguinaldo (mín. 15 días de salario anual)<br>
    • Inscripción al IMSS, INFONAVIT y AFORE desde el primer día<br>
    • Día de descanso semanal con goce de salario<br>
    • PTU si la empresa genera utilidades fiscales<br>
    • Capacitación y adiestramiento (Art. 153-A LFT)</p>
    <p>Cualquier prestación superior a estos mínimos (fondo de ahorro, vales, seguro médico privado, etc.) es voluntaria y depende de la política de cada empresa.</p>`
  },

  // ══════════ IMSS Y SEGURIDAD SOCIAL ══════════
  {
    cat: 'imss',
    q: '¿Desde cuándo debe inscribirse a un trabajador al IMSS?',
    a: `<p>Desde el <strong>primer día</strong> de la relación laboral, sin excepción — incluso durante el período a prueba o de capacitación inicial (<span class="faq-art">Arts. 12 y 15 LSS</span>).</p>
    <p>No inscribir a un trabajador, o hacerlo con un salario menor al real ("subdeclaración salarial"), expone a la empresa a multas del IMSS y a responsabilidad solidaria en caso de accidente o enfermedad del trabajador.</p>`
  },
  {
    cat: 'imss',
    q: '¿Cómo se integra el salario base de cotización para el IMSS?',
    a: `<p>El Salario Base de Cotización (SBC) se calcula con el salario diario más todas las prestaciones, gratificaciones, percepciones, alimentación, habitación, primas, comisiones, y cualquier otra cantidad entregada al trabajador por su trabajo (<span class="faq-art">Art. 27 LSS</span>).</p>
    <p>Existe un <strong>tope máximo de 25 veces el UMA</strong> para efectos de cotización, independientemente de cuánto gane realmente el trabajador.</p>`
  },
  {
    cat: 'imss',
    q: '¿Qué pasa si el IMSS detecta diferencias en las cuotas pagadas?',
    a: `<p>El IMSS puede emitir una <strong>Cédula de Liquidación</strong> determinando diferencias de cuotas omitidas, con actualización y recargos.</p>
    <p>La empresa tiene derecho a impugnar esa determinación si considera que es incorrecta, mediante un recurso de inconformidad ante el propio IMSS, dentro de los plazos legales (normalmente 15 días hábiles desde la notificación).</p>
    <p>Si recibió una notificación de este tipo, contacte a su abogado de inmediato — los plazos para impugnar son cortos y no se pueden recuperar después de vencidos.</p>`
  },

  // ══════════ NOMS Y SEGURIDAD ══════════
  {
    cat: 'noms',
    q: '¿Qué obligaciones genera la NOM-035 para mi empresa?',
    a: `<p>La <span class="faq-art">NOM-035-STPS-2018</span> obliga a identificar, analizar y prevenir los <strong>factores de riesgo psicosocial</strong> en el trabajo (estrés laboral, violencia laboral, jornadas excesivas, etc.).</p>
    <p>Aplica de forma escalonada según el tamaño de la empresa:</p>
    <p>• <strong>Hasta 15 trabajadores:</strong> identificar y analizar factores de riesgo, y adoptar medidas de prevención<br>
    • <strong>16 a 50 trabajadores:</strong> además, aplicar el cuestionario de evaluación del entorno organizacional<br>
    • <strong>Más de 50 trabajadores:</strong> además, realizar evaluaciones específicas y un programa de intervención</p>
    <p>El incumplimiento puede sancionarse con multas de la STPS de 50 a 5,000 veces la UMA.</p>`
  },
  {
    cat: 'noms',
    q: '¿Qué es la Comisión Mixta de Seguridad e Higiene (NOM-019)?',
    a: `<p>Es un órgano obligatorio (<span class="faq-art">NOM-019-STPS-2011</span>, fundamento en <span class="faq-art">Art. 509 LFT</span>) integrado de forma paritaria entre representantes del patrón y de los trabajadores, cuya función es investigar las causas de accidentes/enfermedades de trabajo, proponer medidas preventivas, y vigilar su cumplimiento.</p>
    <p>Debe reunirse periódicamente (recomendado: mensual) y mantener actas de cada sesión. Es exigible independientemente del tamaño de la empresa, aunque la complejidad del programa varía según el número de trabajadores y el grado de riesgo.</p>`
  },
  {
    cat: 'noms',
    q: '¿Qué regula la NOM-037 sobre teletrabajo?',
    a: `<p>La <span class="faq-art">NOM-037-STPS-2023</span> regula las condiciones de seguridad y salud para personas que trabajan bajo la modalidad de teletrabajo (home office), complementando el <span class="faq-art">Art. 330-A LFT</span>.</p>
    <p>Aplica cuando más del 40% de la jornada se realiza desde el domicilio del trabajador u otro lugar elegido por este. El patrón debe proporcionar o compensar el equipo, mobiliario ergonómico y pago de servicios (internet, parte de luz), además de respetar el derecho a la desconexión.</p>`
  },
  {
    cat: 'noms',
    q: '¿Qué dice la NOM-030 sobre servicios preventivos de seguridad?',
    a: `<p>La <span class="faq-art">NOM-030-STPS-2009</span> exige que las empresas con más de 100 trabajadores cuenten con un <strong>Servicio Preventivo de Seguridad y Salud en el Trabajo</strong>, encargado de asesorar en la prevención de riesgos, evaluar condiciones de trabajo, y dar seguimiento a las medidas correctivas.</p>`
  },

  // ══════════ REGLAMENTO INTERIOR ══════════
  {
    cat: 'reglamento',
    q: '¿Es obligatorio tener un Reglamento Interior de Trabajo?',
    a: `<p>Sí. Conforme al <span class="faq-art">Art. 423 LFT</span>, todo centro de trabajo debe contar con un Reglamento Interior de Trabajo, que regula condiciones de trabajo, obligaciones, prohibiciones, y el régimen disciplinario.</p>
    <p>Sin reglamento depositado, el patrón no puede aplicar válidamente sanciones disciplinarias formales, lo que debilita significativamente su posición en cualquier disputa laboral.</p>`
  },
  {
    cat: 'reglamento',
    q: '¿Dónde se deposita el Reglamento Interior de Trabajo?',
    a: `<p>Se deposita ante el <strong>Centro Federal de Conciliación y Registro Laboral (CFCRL)</strong>, conforme a los <span class="faq-art">Arts. 424 y 424-A LFT</span>.</p>
    <p>El Reglamento entra en vigor <strong>8 días después</strong> de su depósito, y debe publicarse físicamente en lugares visibles del centro de trabajo (tableros de avisos, entrada, comedor, etc.).</p>`
  },
  {
    cat: 'reglamento',
    q: '¿Cada cuánto debe actualizarse el Reglamento Interior?',
    a: `<p>La LFT no fija un plazo automático de vencimiento, pero el <span class="faq-art">Art. 426 LFT</span> permite su revisión y modificación cuando sea necesario, mediante acuerdo entre el patrón y la mayoría de trabajadores (o el sindicato, en su caso).</p>
    <p><strong>Recomendación práctica:</strong> revisar y actualizar cada 2 años, o inmediatamente después de cualquier reforma relevante a la LFT (como ocurrió con la NOM-035 o el teletrabajo), para mantenerlo alineado a la legislación vigente.</p>`
  },

  // ══════════ ACTAS ADMINISTRATIVAS ══════════
  {
    cat: 'actas',
    q: '¿Cuál es la diferencia entre apercibimiento, suspensión y rescisión?',
    a: `<p><strong>Apercibimiento:</strong> primera sanción formal, queda como antecedente en el expediente. No implica descuento de salario ni interrupción de labores.</p>
    <p><strong>Suspensión:</strong> sin goce de salario, máximo <strong>8 días por falta</strong> (<span class="faq-art">Art. 110, fracc. I, LFT</span>). Debe ser proporcional a la gravedad de la falta.</p>
    <p><strong>Rescisión:</strong> termina la relación laboral sin responsabilidad para el patrón, cuando se acredita una causal del artículo 47 LFT.</p>
    <p>Lo recomendable es seguir una escala progresiva: apercibimiento → suspensión → rescisión, salvo que la falta sea de tal gravedad que amerite rescisión inmediata.</p>`
  },
  {
    cat: 'actas',
    q: '¿Qué debe contener un acta administrativa para que sea válida?',
    a: `<p>Una acta administrativa sólida debe incluir:</p>
    <p>• Fecha, hora y lugar exactos de los hechos<br>
    • Descripción detallada y objetiva de la conducta (sin juicios subjetivos)<br>
    • Identificación de testigos presentes<br>
    • Oportunidad otorgada al trabajador para manifestar lo que considere (descargo)<br>
    • Firma de quien levanta el acta, testigos, y del trabajador (o constancia de su negativa a firmar)</p>
    <p>La negativa del trabajador a firmar <strong>no invalida</strong> el acta, siempre que quede constancia expresa de dicha negativa.</p>`
  },
  {
    cat: 'actas',
    q: '¿Qué pasa si el trabajador se niega a firmar el acta?',
    a: `<p>No invalida el documento. El representante del patrón y los testigos presentes deben hacer constar expresamente la negativa al pie del acta, idealmente con la frase: <em>"El trabajador se negó a firmar la presente acta, haciéndose constar dicha negativa para los efectos legales correspondientes."</em></p>
    <p>El acta sigue siendo válida como prueba documental ante una eventual demanda laboral.</p>`
  },

  // ══════════ MODALIDADES ESPECIALES ══════════
  {
    cat: 'especiales',
    q: '¿Qué obligaciones tiene el patrón en materia de capacitación y adiestramiento?',
    a: `<p>Conforme al <span class="faq-art">Art. 153-A LFT</span>, todo patrón está obligado a proporcionar capacitación y adiestramiento a sus trabajadores, mediante planes y programas registrados ante la STPS.</p>
    <p>Se requiere una <strong>Comisión Mixta de Capacitación y Adiestramiento</strong> (<span class="faq-art">Art. 153-E LFT</span>), y normalmente se documenta a través de los formatos DC-3 y DC-4 ante la STPS.</p>`
  },
  {
    cat: 'especiales',
    q: '¿Qué es la Comisión de Escalafón y cuándo se requiere?',
    a: `<p>La Comisión de Escalafón (<span class="faq-art">Art. 158 LFT</span>) determina los criterios objetivos para los ascensos del personal dentro de la empresa, evitando decisiones arbitrarias o discriminatorias.</p>
    <p>Es obligatoria en empresas donde existen categorías o niveles jerárquicos que permitan el ascenso de trabajadores, especialmente relevante en empresas sindicalizadas.</p>`
  },

  // ══════════ STPS E INSPECCIONES ══════════
  {
    cat: 'stps',
    q: '¿Qué facultades tienen los inspectores de la STPS durante una visita?',
    a: `<p>Conforme al <span class="faq-art">Art. 541 LFT</span>, los inspectores pueden vigilar el cumplimiento de las normas laborales, examinar documentos, libros y registros, e interrogar al personal sobre cualquier asunto relacionado con la aplicación de las disposiciones laborales.</p>
    <p>Tienen derecho a entrar libremente a los centros de trabajo en cualquier horario en que se preste el servicio, y deben mostrar identificación oficial y orden de visita al patrón o su representante.</p>`
  },
  {
    cat: 'stps',
    q: '¿Qué hago si recibo un acta de inspección de la STPS?',
    a: `<p>Pasos recomendados:</p>
    <p>1. Lea cuidadosamente las observaciones e irregularidades señaladas<br>
    2. Identifique los plazos para subsanar o responder (normalmente especificados en la propia acta)<br>
    3. Reúna la documentación que acredite el cumplimiento o explique la situación<br>
    4. <strong>Contacte a su abogado de inmediato</strong> — los plazos de respuesta suelen ser cortos y las multas pueden ser significativas si no se atienden a tiempo</p>
    <p>Use nuestro botón de WhatsApp al final de esta página para atención inmediata en este tipo de situaciones urgentes.</p>`
  },
  {
    cat: 'stps',
    q: '¿Cuáles son las multas más comunes que impone la STPS?',
    a: `<p>Conforme a los <span class="faq-art">Arts. 992-994 LFT</span>, las multas se calculan en veces la UMA y varían según la gravedad:</p>
    <p>• Faltas generales a obligaciones del patrón: 50 a 2,500 veces la UMA<br>
    • Incumplimiento de NOMs de seguridad e higiene: hasta 5,000 veces la UMA<br>
    • Discriminación o violación a derechos de menores/embarazadas: sanciones agravadas</p>
    <p>El monto exacto depende de la gravedad de la infracción, el número de trabajadores afectados, y si hay reincidencia.</p>`
  },
];
