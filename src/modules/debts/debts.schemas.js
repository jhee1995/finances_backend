const { z } = require('zod');

// Normalizer for camelCase and snake_case flexibility
function normalizeDebtKeys(obj) {
  if (obj && typeof obj === 'object') {
    const copy = { ...obj };

    if (copy.loanAmount !== undefined && copy.loan_amount === undefined) {
      copy.loan_amount = copy.loanAmount;
      delete copy.loanAmount;
    }

    if (copy.interestRate !== undefined && copy.interest_rate === undefined) {
      copy.interest_rate = copy.interestRate;
      delete copy.interestRate;
    }

    if (copy.number_of_installments !== undefined && copy.numberOfInstallments === undefined) {
      copy.numberOfInstallments = copy.number_of_installments;
      delete copy.number_of_installments;
    } else if (copy.numberofinstallments !== undefined && copy.numberOfInstallments === undefined) {
      copy.numberOfInstallments = copy.numberofinstallments;
      delete copy.numberofinstallments;
    }

    if (copy.installments_left !== undefined && copy.installmentsLeft === undefined) {
      copy.installmentsLeft = copy.installments_left;
      delete copy.installments_left;
    } else if (copy.installmentsleft !== undefined && copy.installmentsLeft === undefined) {
      copy.installmentsLeft = copy.installmentsleft;
      delete copy.installmentsleft;
    }

    if (copy.beginDate !== undefined && copy.begin_date === undefined) {
      copy.begin_date = copy.beginDate;
      delete copy.beginDate;
    }

    if (copy.familyId !== undefined && copy.family_id === undefined) {
      copy.family_id = copy.familyId;
      delete copy.familyId;
    }

    if (copy.debt_name !== undefined && copy.name === undefined) {
      copy.name = copy.debt_name;
      delete copy.debt_name;
    }

    if (copy.categoryId !== undefined && copy.category_id === undefined) {
      copy.category_id = copy.categoryId;
      delete copy.categoryId;
    }

    return copy;
  }
  return obj;
}

const createDebtSchema = z.preprocess(normalizeDebtKeys, z.object({
  user_id: z.coerce.number({
    required_error: 'user_id es requerido',
    invalid_type_error: 'user_id debe ser un número entero'
  }).int('user_id debe ser un número entero').positive('user_id debe ser positivo'),

  name: z.string({
    invalid_type_error: 'name debe ser una cadena de texto'
  }).trim().min(1, 'name no puede estar vacío').max(100, 'name no puede superar 100 caracteres').optional(),

  category_id: z.coerce.number({
    required_error: 'category_id es requerido',
    invalid_type_error: 'category_id debe ser un número entero'
  }).int('category_id debe ser un número entero').positive('category_id debe ser positivo'),

  family_id: z.coerce.number({
    invalid_type_error: 'family_id debe ser un número entero'
  }).int('family_id debe ser un número entero').positive('family_id debe ser positivo').nullable().optional(),

  loan_amount: z.coerce.number({
    required_error: 'loan_amount es requerido',
    invalid_type_error: 'loan_amount debe ser un número'
  }).positive('loan_amount debe ser mayor a 0'),

  interest_rate: z.coerce.number({
    required_error: 'interest_rate es requerido',
    invalid_type_error: 'interest_rate debe ser un número'
  }).min(0, 'interest_rate debe ser mayor o igual a 0'),

  numberOfInstallments: z.coerce.number({
    required_error: 'numberOfInstallments es requerido',
    invalid_type_error: 'numberOfInstallments debe ser un número entero'
  }).int('numberOfInstallments debe ser un número entero')
    .min(1, 'numberOfInstallments debe ser al menos 1')
    .max(360, 'numberOfInstallments no puede superar 360 cuotas'),

  installmentsLeft: z.coerce.number({
    invalid_type_error: 'installmentsLeft debe ser un número entero'
  }).int('installmentsLeft debe ser un número entero')
    .min(0, 'installmentsLeft debe ser mayor o igual a 0')
    .optional(),

  begin_date: z.string({
    required_error: 'begin_date es requerido',
    invalid_type_error: 'begin_date debe ser una cadena de texto'
  }).regex(/^\d{4}-\d{2}-\d{2}$/, 'begin_date debe tener formato YYYY-MM-DD')
    .refine(val => !isNaN(Date.parse(val)), { message: 'begin_date debe ser una fecha cronológicamente válida' }),

  status: z.coerce.boolean().optional().default(true)
}).strict({
  message: 'No se permiten propiedades adicionales no autorizadas'
}).refine(data => {
  if (data.installmentsLeft !== undefined && data.installmentsLeft > data.numberOfInstallments) {
    return false;
  }
  return true;
}, {
  message: 'installmentsLeft no puede ser mayor que numberOfInstallments',
  path: ['installmentsLeft']
}));

const updateDebtSchema = z.preprocess(normalizeDebtKeys, z.object({
  name: z.string({
    invalid_type_error: 'name debe ser una cadena de texto'
  }).trim().min(1, 'name no puede estar vacío').max(100, 'name no puede superar 100 caracteres').optional(),

  loan_amount: z.coerce.number({
    invalid_type_error: 'loan_amount debe ser un número'
  }).positive('loan_amount debe ser mayor a 0').optional(),

  interest_rate: z.coerce.number({
    invalid_type_error: 'interest_rate debe ser un número'
  }).min(0, 'interest_rate debe ser mayor o igual a 0').optional(),

  numberOfInstallments: z.coerce.number({
    invalid_type_error: 'numberOfInstallments debe ser un número entero'
  }).int('numberOfInstallments debe ser un número entero')
    .min(1, 'numberOfInstallments debe ser al menos 1')
    .max(360, 'numberOfInstallments no puede superar 360 cuotas')
    .optional(),

  installmentsLeft: z.coerce.number({
    invalid_type_error: 'installmentsLeft debe ser un número entero'
  }).int('installmentsLeft debe ser un número entero')
    .min(0, 'installmentsLeft debe ser mayor o igual a 0')
    .optional(),

  begin_date: z.string({
    invalid_type_error: 'begin_date debe ser una cadena de texto'
  }).regex(/^\d{4}-\d{2}-\d{2}$/, 'begin_date debe tener formato YYYY-MM-DD')
    .refine(val => !isNaN(Date.parse(val)), { message: 'begin_date debe ser una fecha cronológicamente válida' })
    .optional(),

  status: z.coerce.boolean().optional(),

  category_id: z.coerce.number({
    invalid_type_error: 'category_id debe ser un número entero'
  }).int('category_id debe ser un número entero').positive('category_id debe ser positivo').optional(),

  family_id: z.coerce.number({
    invalid_type_error: 'family_id debe ser un número entero'
  }).int('family_id debe ser un número entero').positive('family_id debe ser positivo').nullable().optional(),

  user_id: z.coerce.number({
    invalid_type_error: 'user_id debe ser un número entero'
  }).int('user_id debe ser un número entero').positive('user_id debe ser positivo').optional()
}).strict({
  message: 'No se permiten propiedades adicionales no autorizadas'
}).refine(data => Object.keys(data).length > 0, {
  message: 'Debe proporcionar al menos un campo para actualizar la deuda'
}).refine(data => {
  if (data.numberOfInstallments !== undefined && data.installmentsLeft !== undefined) {
    return data.installmentsLeft <= data.numberOfInstallments;
  }
  return true;
}, {
  message: 'installmentsLeft no puede ser mayor que numberOfInstallments',
  path: ['installmentsLeft']
}));

const listDebtsQuerySchema = z.object({
  user_id: z.string().regex(/^\d+$/, 'user_id debe ser un número entero positivo').transform(Number).optional(),
  category_id: z.string().regex(/^\d+$/, 'category_id debe ser un número entero positivo').transform(Number).optional(),
  status: z.enum(['true', 'false', '1', '0']).transform(val => val === 'true' || val === '1').optional(),
  family_id: z.string().regex(/^\d+$/, 'family_id debe ser un número entero positivo').transform(Number).optional()
});

const debtIdParamSchema = z.object({
  id: z.string({
    required_error: 'id es requerido'
  }).regex(/^\d+$/, 'id debe ser un número entero positivo').transform(Number)
});

// Normalizer for simulation payload keys
function normalizeSimulateKeys(obj) {
  if (obj && typeof obj === 'object') {
    const copy = { ...obj };

    if (copy.interest_rate_ea !== undefined && copy.interestRateEA === undefined) {
      copy.interestRateEA = copy.interest_rate_ea;
      delete copy.interest_rate_ea;
    } else if (copy.interestRate !== undefined && copy.interestRateEA === undefined) {
      copy.interestRateEA = copy.interestRate;
      delete copy.interestRate;
    }

    if (copy.begin_date !== undefined && copy.beginDate === undefined) {
      copy.beginDate = copy.begin_date;
      delete copy.begin_date;
    }

    if (copy.debt_id !== undefined && copy.debtId === undefined) {
      copy.debtId = copy.debt_id;
      delete copy.debt_id;
    }

    if (copy.extra_payments !== undefined && copy.extraPayments === undefined) {
      copy.extraPayments = copy.extra_payments;
      delete copy.extra_payments;
    }

    if (Array.isArray(copy.extraPayments)) {
      copy.extraPayments = copy.extraPayments.map(ep => {
        if (ep && typeof ep === 'object') {
          const epCopy = { ...ep };
          if (epCopy.installment_number !== undefined && epCopy.installmentNumber === undefined) {
            epCopy.installmentNumber = epCopy.installment_number;
            delete epCopy.installment_number;
          }
          if (typeof epCopy.type === 'string') {
            epCopy.type = epCopy.type.toUpperCase();
          }
          return epCopy;
        }
        return ep;
      });
    }

    if (typeof copy.system === 'string') {
      copy.system = copy.system.toUpperCase();
    }

    return copy;
  }
  return obj;
}

const extraPaymentItemSchema = z.object({
  installmentNumber: z.coerce.number({
    required_error: 'installmentNumber es requerido en el abono extraordinario',
    invalid_type_error: 'installmentNumber debe ser un número entero'
  }).int('installmentNumber debe ser un número entero')
    .min(1, 'installmentNumber debe ser al menos 1')
    .max(360, 'installmentNumber no puede superar 360'),

  amount: z.coerce.number({
    required_error: 'amount es requerido en el abono extraordinario',
    invalid_type_error: 'amount debe ser un número'
  }).positive('amount del abono extraordinario debe ser mayor a 0'),

  type: z.enum(['REDUCE_TERM', 'REDUCE_PAYMENT'], {
    invalid_type_error: 'type debe ser REDUCE_TERM o REDUCE_PAYMENT'
  }).optional().default('REDUCE_TERM')
}).strict({
  message: 'No se permiten propiedades adicionales en los abonos extraordinarios'
});

const simulateDebtSchema = z.preprocess(normalizeSimulateKeys, z.object({
  amount: z.coerce.number({
    invalid_type_error: 'amount debe ser un número'
  }).positive('amount debe ser mayor a 0')
    .max(1000000000000, 'amount no puede superar 1 billón')
    .optional(),

  interestRateEA: z.coerce.number({
    invalid_type_error: 'interestRateEA debe ser un número'
  }).min(0, 'interestRateEA debe ser mayor o igual a 0')
    .max(200, 'interestRateEA no puede superar 200%')
    .optional(),

  installments: z.coerce.number({
    invalid_type_error: 'installments debe ser un número entero'
  }).int('installments debe ser un número entero')
    .min(1, 'installments debe ser al menos 1')
    .max(360, 'installments no puede superar 360 cuotas')
    .optional(),

  beginDate: z.string({
    invalid_type_error: 'beginDate debe ser una cadena de texto'
  }).regex(/^\d{4}-\d{2}-\d{2}$/, 'beginDate debe tener formato YYYY-MM-DD')
    .refine(val => !isNaN(Date.parse(val)), { message: 'beginDate debe ser una fecha cronológicamente válida' })
    .optional(),

  system: z.enum(['FRENCH', 'GERMAN'], {
    invalid_type_error: 'system debe ser FRENCH o GERMAN'
  }).optional().default('FRENCH'),

  debtId: z.coerce.number({
    invalid_type_error: 'debtId debe ser un número entero'
  }).int('debtId debe ser un número entero')
    .positive('debtId debe ser un número positivo')
    .optional(),

  extraPayments: z.array(extraPaymentItemSchema).optional()
}).strict({
  message: 'No se permiten propiedades adicionales no autorizadas'
}).refine(data => {
  if (!data.debtId) {
    return data.amount !== undefined && data.interestRateEA !== undefined && data.installments !== undefined;
  }
  return true;
}, {
  message: 'Si no se proporciona debtId, los campos amount, interestRateEA e installments son obligatorios',
  path: ['amount']
}));

const createDebtPaymentSchema = z.preprocess((obj) => {
  if (obj && typeof obj === 'object') {
    const copy = { ...obj };
    if (copy.paymentDate !== undefined && copy.payment_date === undefined) {
      copy.payment_date = copy.paymentDate;
      delete copy.paymentDate;
    }
    if (copy.userId !== undefined && copy.user_id === undefined) {
      copy.user_id = copy.userId;
      delete copy.userId;
    }
    return copy;
  }
  return obj;
}, z.object({
  user_id: z.coerce.number({
    invalid_type_error: 'user_id debe ser un número entero'
  }).int('user_id debe ser un número entero').positive('user_id debe ser positivo').optional(),

  amount: z.coerce.number({
    required_error: 'amount es requerido',
    invalid_type_error: 'amount debe ser un número'
  }).positive('amount debe ser mayor a 0')
    .max(1000000000, 'amount no puede superar 1 billón'),

  payment_date: z.string({
    invalid_type_error: 'payment_date debe ser una cadena de texto'
  }).regex(/^\d{4}-\d{2}-\d{2}$/, 'payment_date debe tener formato YYYY-MM-DD')
    .refine(val => !isNaN(Date.parse(val)), { message: 'payment_date debe ser una fecha cronológicamente válida' })
    .optional()
}).strict({
  message: 'No se permiten propiedades adicionales no autorizadas'
}));

module.exports = {
  createDebtSchema,
  updateDebtSchema,
  listDebtsQuerySchema,
  debtIdParamSchema,
  simulateDebtSchema,
  createDebtPaymentSchema
};
