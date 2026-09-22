const { z } = require('zod');

const pinRegex = /^\d{6}$/;

const setupPinSchema = z
  .object({
    pin: z.string().regex(pinRegex, 'PIN must be exactly 6 numeric digits'),
    confirmPin: z.string().regex(pinRegex, 'Confirm PIN must be exactly 6 numeric digits')
  })
  .refine((data) => data.pin === data.confirmPin, {
    message: 'PIN and Confirm PIN must match',
    path: ['confirmPin']
  });

const verifyPinSchema = z.object({
  pin: z.string().regex(pinRegex, 'PIN must be exactly 6 numeric digits')
});

const changePinSchema = z
  .object({
    currentPin: z.string().regex(pinRegex, 'Current PIN must be exactly 6 numeric digits'),
    newPin: z.string().regex(pinRegex, 'New PIN must be exactly 6 numeric digits'),
    confirmNewPin: z.string().regex(pinRegex, 'Confirm new PIN must be exactly 6 numeric digits')
  })
  .refine((data) => data.newPin === data.confirmNewPin, {
    message: 'New PIN and Confirm New PIN must match',
    path: ['confirmNewPin']
  })
  .refine((data) => data.currentPin !== data.newPin, {
    message: 'New PIN must be different from current PIN',
    path: ['newPin']
  });

module.exports = {
  setupPinSchema,
  verifyPinSchema,
  changePinSchema
};
