let io = null;

export function setIo(instance) {
  io = instance;
}

export function getIo() {
  return io;
}

export function emitToUser(userId, event, payload) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, payload);
}

export function emitToRole(role, event, payload) {
  if (!io) return;
  io.to(`role:${role}`).emit(event, payload);
}

export function broadcast(event, payload) {
  if (!io) return;
  io.emit(event, payload);
}