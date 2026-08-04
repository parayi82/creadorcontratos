// lft-glosario.js
// ════════════════════════════════════════════════════════
// GLOSARIO DE ARTÍCULOS DE LA LFT POR PALABRA CLAVE
// ClickLaboral.mx
//
// A diferencia de FAQ_DATA (preguntas y respuestas fijas), este glosario
// indexa los artículos más consultados de la Ley Federal del Trabajo por
// los temas/palabras que normalmente los traen a colación. Sirve como
// respaldo cuando una pregunta no calza con ninguna FAQ predefinida —
// en vez de decir "no encontramos nada", se listan los artículos de la
// LFT relacionados con las palabras de la pregunta.
//
// No es exhaustivo de los 1000+ artículos de la LFT (sería impráctico
// y poco útil); cubre los ~90 artículos que con más frecuencia necesita
// consultar un patrón de PyME en el día a día.
// ════════════════════════════════════════════════════════

const LFT_GLOSARIO = [
  { art: '5', tema: 'Derechos irrenunciables del trabajador', resumen: 'Las disposiciones de la LFT son de orden público; no es válida ninguna cláusula que renuncie a los derechos mínimos que la ley otorga al trabajador.', keywords: ['renuncia','derechos','irrenunciable','clausula','nulo'] },
  { art: '20', tema: 'Relación de trabajo y contrato individual', resumen: 'Define la relación de trabajo como la prestación de un servicio personal subordinado a cambio de un salario, exista o no contrato escrito.', keywords: ['relacion','laboral','subordinado','contrato','salario'] },
  { art: '25', tema: 'Contenido obligatorio del contrato individual', resumen: 'Enlista los elementos que todo contrato individual de trabajo debe contener: datos de las partes, duración, lugar, jornada, salario, día de descanso y vacaciones.', keywords: ['contrato','elementos','requisitos','clausulas'] },
  { art: '33', tema: 'Nulidad de la renuncia de derechos laborales', resumen: 'Es nula la renuncia que el trabajador haga de salarios devengados, indemnizaciones y demás prestaciones derivadas de los servicios prestados. Todo convenio de terminación debe constar por escrito con detalle de los hechos y prestaciones.', keywords: ['renuncia','convenio','liquidacion','finiquito','nulo','derechos'] },
  { art: '35', tema: 'Tipos de contrato y regla general', resumen: 'El contrato por tiempo indeterminado es la regla general; los demás tipos (determinado, obra, temporada) requieren justificarse por la naturaleza del trabajo.', keywords: ['contrato','indeterminado','determinado','duracion','tipo'] },
  { art: '36', tema: 'Contrato por tiempo determinado', resumen: 'Solo es válido un contrato por tiempo determinado cuando lo justifica la naturaleza del trabajo, sustitución temporal de otro trabajador, u otro objeto de trabajo de naturaleza temporal.', keywords: ['contrato','determinado','temporal','obra','sustitucion'] },
  { art: '39', tema: 'Prórroga del contrato por tiempo determinado', resumen: 'Si subsiste la causa que dio origen al contrato por tiempo determinado y la materia del trabajo, la relación se prorroga por el tiempo que dure dicha circunstancia.', keywords: ['contrato','determinado','prorroga','renovacion'] },
  { art: '39-A', tema: 'Período a prueba', resumen: 'El período a prueba no puede exceder 30 días, o 180 días para puestos de dirección/gerenciales o trabajos que requieran conocimientos especializados.', keywords: ['prueba','periodo','30 dias','180 dias','gerencial'] },
  { art: '39-B', tema: 'Capacitación inicial', resumen: 'La capacitación inicial no puede exceder 3 meses, o 6 meses para puestos de dirección o trabajos especializados.', keywords: ['capacitacion','inicial','3 meses','6 meses'] },
  { art: '42', tema: 'Suspensión de la relación de trabajo', resumen: 'Causas que suspenden temporalmente la relación laboral sin terminarla: enfermedad contagiosa, incapacidad temporal, prisión preventiva, arresto, cumplimiento de servicios públicos, entre otras.', keywords: ['suspension','incapacidad','enfermedad','prision','arresto'] },
  { art: '47', tema: 'Causas de rescisión sin responsabilidad para el patrón (despido justificado)', resumen: 'Enumera las causas por las que el patrón puede despedir sin responsabilidad: engaño, faltas de probidad, violencia, daño intencional, negligencia grave, actos inmorales, revelar secretos, más de 3 faltas injustificadas en 30 días, entre otras. El aviso de rescisión debe darse por escrito.', keywords: ['despido','rescision','justificado','faltas','probidad','injustificada'] },
  { art: '48', tema: 'Indemnización por despido injustificado', resumen: 'Si el despido es injustificado, el trabajador puede optar por la reinstalación o por una indemnización de 3 meses de salario más 20 días por año de servicio, además de salarios vencidos.', keywords: ['despido','injustificado','indemnizacion','reinstalacion','3 meses','20 dias'] },
  { art: '50', tema: 'Monto de las indemnizaciones', resumen: 'Establece cómo se calcula la indemnización según el tipo de contrato: por tiempo determinado o indeterminado, con sus reglas específicas de cálculo.', keywords: ['indemnizacion','monto','calculo','despido'] },
  { art: '51', tema: 'Causas de rescisión sin responsabilidad para el trabajador (despido indirecto)', resumen: 'Causas por las que el trabajador puede rescindir la relación sin responsabilidad para él (equivalente a un despido injustificado): engaño del patrón, falta de pago de salario, peligro a su seguridad, entre otras.', keywords: ['rescision','trabajador','despido indirecto','peligro','salario'] },
  { art: '53', tema: 'Causas de terminación de las relaciones de trabajo', resumen: 'Son causas de terminación: mutuo consentimiento, muerte del trabajador, terminación de la obra o vencimiento del término, e incapacidad física o mental que haga imposible la prestación del trabajo.', keywords: ['terminacion','mutuo','consentimiento','muerte','incapacidad','renuncia'] },
  { art: '76', tema: 'Vacaciones — período mínimo', resumen: 'Los trabajadores con más de un año de servicio tienen derecho a un período de vacaciones pagadas, que va aumentando con la antigüedad conforme a la tabla de la ley (reforma "vacaciones dignas" 2023).', keywords: ['vacaciones','dias','antiguedad','periodo'] },
  { art: '79', tema: 'Requisito de antigüedad para vacaciones', resumen: 'El derecho a vacaciones surge al cumplirse un año de servicios; no es necesario que el trabajador labore de forma continua.', keywords: ['vacaciones','antiguedad','un año','requisito'] },
  { art: '80', tema: 'Prima vacacional', resumen: 'Los trabajadores tienen derecho a una prima no menor del 25% sobre los salarios que les correspondan durante el período de vacaciones.', keywords: ['prima vacacional','25%','vacaciones'] },
  { art: '87', tema: 'Aguinaldo', resumen: 'Los trabajadores tienen derecho a un aguinaldo anual de al menos 15 días de salario, pagadero antes del 20 de diciembre. Si no se ha cumplido el año, se paga la parte proporcional.', keywords: ['aguinaldo','15 dias','diciembre','proporcional'] },
  { art: '89', tema: 'Salario base para el cálculo de prestaciones', resumen: 'Define cómo se integra el salario para efecto del cálculo de indemnizaciones y prestaciones, incluyendo pagos hechos en efectivo, gratificaciones, percepciones, habitación, primas, comisiones y prestaciones en especie.', keywords: ['salario','integrado','calculo','prestaciones'] },
  { art: '123', tema: 'Pago de salarios', resumen: 'El salario debe pagarse directamente al trabajador, en moneda de curso legal, en el lugar donde preste sus servicios, dentro de las horas de trabajo o inmediatamente después.', keywords: ['salario','pago','lugar','moneda'] },
  { art: '162', tema: 'Prima de antigüedad', resumen: 'Los trabajadores tienen derecho a una prima de antigüedad de 12 días de salario por cada año de servicios, pagadera al terminar la relación laboral en los casos que marca la ley (renuncia con 15+ años, despido, etc.), con un tope de dos veces el salario mínimo.', keywords: ['prima antiguedad','12 dias','15 años','tope'] },
  { art: '170', tema: 'Derechos de las trabajadoras embarazadas', resumen: 'Las trabajadoras embarazadas tienen derecho a un descanso de 6 semanas antes y 6 después del parto, con goce de sueldo íntegro, y a regresar a su puesto al concluir el descanso.', keywords: ['embarazo','embarazada','maternidad','parto','descanso','incapacidad','lactancia'] },
  { art: '132', tema: 'Obligaciones del patrón', resumen: 'Enumera las obligaciones generales del patrón: pagar salarios, proporcionar útiles de trabajo, guardar consideración al trabajador, expedir constancias de trabajo, entre muchas otras.', keywords: ['obligaciones','patron','constancia'] },
  { art: '133', tema: 'Prohibiciones al patrón', resumen: 'Prohíbe al patrón negarse a recibir trabajadores por edad/sexo/discapacidad, exigir certificados de no embarazo, despedir a una trabajadora embarazada, entre otras conductas discriminatorias.', keywords: ['discriminacion','embarazo','embarazada','prohibiciones','patron','despedir'] },
  { art: '423', tema: 'Reglamento Interior de Trabajo', resumen: 'El reglamento interior de trabajo es el conjunto de disposiciones que regulan la prestación del trabajo en la empresa; debe registrarse ante la autoridad correspondiente.', keywords: ['reglamento interior','registro','disposiciones'] },
  { art: '504', tema: 'Comisión de Seguridad e Higiene', resumen: 'Los centros de trabajo deben contar con una comisión mixta de seguridad e higiene, integrada paritariamente por representantes del patrón y trabajadores.', keywords: ['comision','seguridad','higiene','mixta'] },
  { art: '527', tema: 'Riesgos de trabajo', resumen: 'Define los riesgos de trabajo como los accidentes y enfermedades a que están expuestos los trabajadores en ejercicio o con motivo del trabajo.', keywords: ['riesgo','accidente','enfermedad','trabajo'] },
];

const LFT_STOPWORDS = new Set(['cuando','como','que','cual','cuales','donde','quien','quienes','para','por','con','sin','sobre','este','esta','estos','estas','ese','esa','esos','esas','debo','debe','deben','puedo','puede','pueden','hay','estan','esto','son','las','los','una','unos','unas','del','les','muy','mas','todo','toda','todos','todas','tengo','tiene','tienen','dias','dia','anos','ano','sera','seria','tipo','tipos','sido','siendo','desde','hasta','entre','cada','otro','otra','algun','alguna','algunos','tener','hacer','haber','tambien','solo','si','no','mi','su','sus','trabajador','trabajadores','empresa','patron','ley','laboral','articulo','caso']);

function _normalizarTexto(s){
  return (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}

function tokenizarLFT(txt){
  return _normalizarTexto(txt).split(/[^a-z0-9]+/).filter(w=>{
    if(!w || w.length<4) return false;
    if(LFT_STOPWORDS.has(w)) return false;
    return true;
  });
}

// Compara dos palabras normalizadas permitiendo coincidencia por raíz común
// (ej. "embarazada" vs "embarazo" comparten "embaraz"). Evita falsos positivos
// en palabras cortas exigiendo al menos 5 caracteres de raíz compartida.
function _coincideRaiz(a, b){
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const minLen = Math.min(a.length, b.length);
  if (minLen < 5) return false;
  const raizLen = Math.min(6, minLen - 1);
  return a.slice(0, raizLen) === b.slice(0, raizLen);
}

// Búsqueda por coincidencia de palabras clave contra el glosario.
// Devuelve hasta `max` artículos ordenados por número de palabras que coinciden.
function buscarEnGlosarioLFT(pregunta, max){
  max = max || 5;
  const palabras = tokenizarLFT(pregunta);
  if(!palabras.length) return [];

  const resultados = LFT_GLOSARIO.map(item=>{
    const kwNormalizadas = item.keywords.map(_normalizarTexto);
    let coincidencias = 0;
    palabras.forEach(p=>{
      if(kwNormalizadas.some(kw => _coincideRaiz(kw, p))) coincidencias++;
    });
    return { item, coincidencias };
  }).filter(r=>r.coincidencias>0);

  resultados.sort((a,b)=>b.coincidencias-a.coincidencias);
  return resultados.slice(0,max).map(r=>r.item);
}
