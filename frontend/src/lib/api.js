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

  reportsSummary: () => api.get(`/reports/summary`).then((r) => r.data),

  registerScript: (payload) => api.post(`/scripts`, payload).then((r) => r.data),
  listScripts: (country) => api.get(`/scripts`, { params: country ? { country } : {} }).then((r) => r.data),
  deleteScript: (id) => api.delete(`/scripts/${id}`).then((r) => r.data),

  testWhatsapp: (country) => api.post(`/whatsapp/test/${country}`).then((r) => r.data),
};
