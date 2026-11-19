export const ROLES = ['customer', 'technician', 'admin'];

export const REQUEST_STATUSES = [
  'pending',
  'accepted',
  'on_the_way',
  'arrived',
  'in_progress',
  'completed',
  'cancelled',
];

// Statuses that mean work has started; customers cannot reschedule/cancel after this point.
export const WORK_STARTED_STATUSES = ['on_the_way', 'arrived', 'in_progress', 'completed'];

export const URGENCIES = ['low', 'normal', 'high', 'emergency'];

export const TIME_SLOTS = [
  '08:00-10:00',
  '10:00-12:00',
  '13:00-15:00',
  '15:00-17:00',
  '17:00-19:00',
];

export const VERIFICATION_STATUSES = ['pending', 'verified', 'rejected', 'suspended'];

export const DOCUMENT_TYPES = ['government_id', 'selfie_id', 'certificate', 'clearance'];

export const REVIEW_TAGS = ['On time', 'Professional', 'Fair price', 'Clean work', 'Friendly'];

export const NOTIFICATION_TYPES = [
  'request_created',
  'request_available',
  'request_assigned',
  'request_accepted',
  'request_declined',
  'status_changed',
  'schedule_changed',
  'job_reminder',
  'chat_message',
  'verification_submitted',
  'verification_decision',
  'new_review',
  'review_reply',
  'announcement',
  'system',
];

export const ANNOUNCEMENT_STYLES = ['info', 'warning', 'success'];

export const STATUS_LABELS = {
  pending: 'Pending',
  accepted: 'Accepted',
  on_the_way: 'On the way',
  arrived: 'Arrived',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

// Allowed forward transitions. Cancelling is handled separately with actor checks.
export const STATUS_TRANSITIONS = {
  pending: ['accepted', 'cancelled'],
  accepted: ['on_the_way', 'cancelled'],
  on_the_way: ['arrived', 'cancelled'],
  arrived: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};