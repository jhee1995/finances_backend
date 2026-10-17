const express = require('express');
const cors = require('cors');
const { config } = require('./config/env');
const { getHealth } = require('./modules/system/health.controller');
const usersRoutes = require('./modules/users/users.routes');
const categoriesRoutes = require('./modules/categories/categories.routes');
const authRoutes = require('./modules/auth/auth.routes');
const incomesRoutes = require('./modules/incomes/incomes.routes');
const expensesRoutes = require('./modules/expenses/expenses.routes');
const dashboardRoutes = require('./modules/dashboard/dashboard.routes');
const debtsRoutes = require('./modules/debts/debts.routes');
const familyRoutes = require('./modules/family/family.routes');
const paymentPlansRoutes = require('./modules/payment_plans/payment_plans.routes');
const goalsRoutes = require('./modules/goals/goals.routes');
const telegramRoutes = require('./modules/telegram/telegram.routes');
const recurringObligationsRoutes = require('./modules/recurring_obligations/recurring_obligations.routes');
const { close } = require('./shared/database/db');

const app = express();

app.use(cors({
  origin: config.CORS_ORIGIN,
  credentials: true
}));
app.use(express.json());

// System Health Probe Route (Contract: SYS-001)
app.get('/api/health', getHealth);

// Users Management Routes (Contracts: USR-001, USR-002, USR-003)
app.use('/api/users', usersRoutes);

// Categories Management Routes (Contracts: CAT-001 to CAT-005)
app.use('/api/categories', categoriesRoutes);

// Authentication Routes (Contracts: AUTH-001, AUTH-002)
app.use('/api/auth', authRoutes);

// CashFlow Incomes Management Routes (Contracts: INC-001 to INC-005)
app.use('/api/incomes', incomesRoutes);

// Outcome Expenses Management Routes (Contracts: EXP-001 to EXP-005)
app.use('/api/expenses', expensesRoutes);

// Dashboard Analytics Routes (Contract: DSH-001)
app.use('/api/dashboard', dashboardRoutes);

// Debts Management Routes (Contracts: DEB-001 to DEB-005)
app.use('/api/debts', debtsRoutes);

// Family Finances Routes (Contracts: FAM-001 to FAM-006)
app.use('/api/family', familyRoutes);

// Payment Plans Optimization Routes (Contracts: PLN-001 to PLN-003)
app.use('/api/payment-plans', paymentPlansRoutes);

// Financial Goals Routes (Contracts: GOL-001 to GOL-005)
app.use('/api/goals', goalsRoutes);

// Telegram Account Link & Notifications (Contracts: TEL-001 to TEL-005)
app.use('/api/telegram', telegramRoutes);

// Recurring Obligations Management Routes (Contracts: REC-001 to REC-005)
app.use('/api/recurring-obligations', recurringObligationsRoutes);

let server;

if (require.main === module) {
  server = app.listen(config.PORT, () => {
    console.log(`Finances Backend running on http://localhost:${config.PORT} [${config.NODE_ENV}]`);
  });

  const handleShutdown = async (signal) => {
    console.log(`Received ${signal}. Gracefully shutting down...`);
    if (server) {
      server.close(async () => {
        await close();
        console.log('Server and database pool closed. Exiting process.');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}

module.exports = app;
