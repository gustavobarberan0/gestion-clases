
// ===== IMPORTAR ALUMNOS =====
let importPreviewData = [];

function openModalImportar() {
  resetImport();
  document.getElementById('modalImportar').classList.add('open');
}

function resetImport() {
  importPreviewData = [];
  document.getElementById('importStep1').style.display = 'block';
  document.getElementById('importStep2').style.display = 'none';
  document.getElementById('importStep3').style.display = 'none';
  document.getElementById('btnConfirmImport').style.display = 'none';
  const fi = document.getElementById('importFile');
  if (fi) fi.value = '';
  document.getElementById('modalImportar').classList.remove('open');
}

async function handleImportFile(input) {
  const file = input.files[0];
  if (!file) return;

  // Mostrar spinner
  document.getElementById('importStep1').style.display = 'none';
  document.getElementById('importStep3').style.display = 'block';

  const formData = new FormData();
  formData.append('planilla', file);

  try {
    const res = await fetch('/api/clases/' + currentClaseId + '/importar-alumnos?preview=1', {
      method: 'POST',
      credentials: 'same-origin',
      body: formData,
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Error procesando el archivo', 'error');
      document.getElementById('importStep3').style.display = 'none';
      document.getElementById('importStep1').style.display = 'block';
      return;
    }

    importPreviewData = data.alumnos;

    // Mostrar preview
    document.getElementById('importStep3').style.display = 'none';
    document.getElementById('importStep2').style.display = 'block';
    document.getElementById('btnConfirmImport').style.display = 'inline-flex';

    const count = data.alumnos.length;
    document.getElementById('previewCount').innerHTML =
      'Se encontraron <strong>' + count + ' alumno' + (count !== 1 ? 's' : '') + '</strong> en el archivo.';

    document.getElementById('previewBody').innerHTML = data.alumnos.slice(0, 50).map((a, i) =>
      '<tr><td style="color:var(--text2)">' + (i + 1) + '</td>' +
      '<td><strong>' + (a.nombre || '-') + '</strong></td>' +
      '<td style="color:var(--text2)">' + (a.email || '-') + '</td>' +
      '<td style="color:var(--text2)">' + (a.dni || '-') + '</td></tr>'
    ).join('') + (count > 50 ? '<tr><td colspan="4" style="text-align:center;color:var(--text2);font-size:.75rem;padding:.6rem">... y ' + (count - 50) + ' más</td></tr>' : '');

  } catch (e) {
    showToast('Error de conexión', 'error');
    document.getElementById('importStep3').style.display = 'none';
    document.getElementById('importStep1').style.display = 'block';
  }
}

async function confirmarImport() {
  const fileInput = document.getElementById('importFile');
  if (!fileInput.files[0]) return;

  document.getElementById('importStep2').style.display = 'none';
  document.getElementById('importStep3').style.display = 'block';
  document.getElementById('btnConfirmImport').style.display = 'none';

  const formData = new FormData();
  formData.append('planilla', fileInput.files[0]);

  try {
    const res = await fetch('/api/clases/' + currentClaseId + '/importar-alumnos', {
      method: 'POST',
      credentials: 'same-origin',
      body: formData,
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Error al importar', 'error');
    } else {
      showToast('✓ ' + data.agregados + ' alumnos importados correctamente', 'success');
      await loadData();
      if (currentClaseId) renderClaseDetail(currentClaseId);
    }
    resetImport();
  } catch (e) {
    showToast('Error de conexión', 'error');
    resetImport();
  }
}

// Drag & drop
document.addEventListener('DOMContentLoaded', () => {
  const zone = document.getElementById('importZone');
  if (!zone) return;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) {
      const input = document.getElementById('importFile');
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      handleImportFile(input);
    }
  });
});
