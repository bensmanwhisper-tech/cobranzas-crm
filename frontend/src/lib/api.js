import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({
  baseURL: API,
  timeout: 30000,
});

export const endpoints = {
  getConfig: (country) => api.get(`/config/${country}`).then((r) => r.data),
  saveConfig: (country, cfg) => api.put(`/config/${country}`, cfg).then((r) => r.data),
  listConfigs: () => api.get(`/config`).then((r) => r.data),

  listContacts: (params) => api.get(`/contacts`, { params }).then((r) => r.data),
  createContact: (payload) => api.post(`/contacts`, payload).then((r) => r.data),
  updateContact: (id, patch) => api.patch(`/contacts/${id}`, patch).then((r) => r.data),
  deleteContact: (id) => api.delete(`/contacts/${id}`).then((r) => r.data),
  bulkDeleteContacts: (ids) => api.post(`/contacts/bulk-delete`, { ids }).then((r) => r.data),
  // Notes / Reminders / Recovered
  addNote: (id, text, author) => api.post(`/contacts/${id}/notes`, { text, author }).then((r) => r.data),
  deleteNote: (id, noteId) => api.delete(`/contacts/${id}/notes/${noteId}`).then((r) => r.data),
  addReminder: (id, text, due_at) => api.post(`/contacts/${id}/reminders`, { text, due_at }).then((r) => r.data),
  toggleReminder: (id, reminderId) => api.patch(`/contacts/${id}/reminders/${reminderId}/toggle`).then((r) => r.data),
  deleteReminder: (id, reminderId) => api.delete(`/contacts/${id}/reminders/${reminderId}`).then((r) => r.data),
  setRecovered: (id, monto_recuperado, marcar_pagado = false) =>
    api.patch(`/contacts/${id}/recovered`, { monto_recuperado, marcar_pagado }).then((r) => r.data),
  importCsv: (country, file) => {
    const fd = new FormData();
    fd.append("country", country);
    fd.append("file", file);
    return api.post(`/contacts/import`, fd, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then((r) => r.data);
  },
  seedDemo: (country) => api.post(`/contacts/seed-demo`, null, { params: country ? { country } : {} }).then((r) => r.data),

  getTemplates: (country) => api.get(`/templates/${country}`).then((r) => r.data),
  saveTemplate: (payload) => api.put(`/templates`, payload).then((r) => r.data),

  getLogs: (params) => api.get(`/logs`, { params }).then((r) => r.data),
  createLog: (payload) => api.post(`/logs`, payload).then((r) => r.data),
  clearLogs: () => api.delete(`/logs`).then((r) => r.data),

  send: (payload) => api.post(`/send`, payload).then((r) => r.data),

  reportsSummary: (country) => api.get(`/reports/summary`, { params: country ? { country } : {} }).then((r) => r.data),

  registerScript: (payload) => api.post(`/scripts`, payload).then((r) => r.data),
  listScripts: (country) => api.get(`/scripts`, { params: country ? { country } : {} }).then((r) => r.data),
  deleteScript: (id) => api.delete(`/scripts/${id}`).then((r) => r.data),

  testWhatsapp: (country) => api.post(`/whatsapp/test/${country}`).then((r) => r.data),

  // Files / Storage
  uploadFile: (file, { category = "other", country, note = "" } = {}) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("category", category);
    if (country) fd.append("country", country);
    if (note) fd.append("note", note);
    return api.post(`/files/upload`, fd, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then((r) => r.data);
  },
  listFiles: (params) => api.get(`/files`, { params }).then((r) => r.data),
  deleteFile: (id) => api.delete(`/files/${id}`).then((r) => r.data),
  fileDownloadUrl: (id) => `${API}/files/${id}/download`,
  importContactsFromFile: (id) => api.post(`/files/import-contacts/${id}`).then((r) => r.data),

  // WhatsApp Center
  whatsappImportCsv: (country, dialCode, file) => {
    const fd = new FormData();
    fd.append("country", country);
    if (dialCode) fd.append("dial_code", dialCode);
    fd.append("file", file);
    return api.post(`/whatsapp/import`, fd, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then((r) => r.data);
  },
  whatsappQr: (country) => api.get(`/whatsapp/qr/${country}`).then((r) => r.data),
  whatsappConnect: (country, payload) => api.post(`/whatsapp/connect/${country}`, payload).then((r) => r.data),
  whatsappDisconnect: (country) => api.post(`/whatsapp/disconnect/${country}`).then((r) => r.data),
  whatsappStatus: (country) => api.get(`/whatsapp/status/${country}`).then((r) => r.data),

  fxRates: () => api.get(`/fx/rates`).then((r) => r.data),
};
