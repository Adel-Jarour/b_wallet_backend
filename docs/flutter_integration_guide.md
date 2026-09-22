# B-Wallet — Flutter & GetX Backend Integration Guide
**Target Client**: Flutter (iOS & Android)  
**State Management**: GetX  
**Networking**: Dio  
**Local Secure Storage**: flutter_secure_storage  
**Realtime Engine**: Supabase Realtime Client  
**Charts**: Syncfusion Flutter Charts  
**Backend API Version**: 1.0.0 (Sprint 10 Final Backend Release)

---

## 1. Network Configuration & Environment Setup

### 1.1 Base URL Matrix

| Environment / Device | Base URL | Notes |
| :--- | :--- | :--- |
| **Android Emulator** | `http://10.0.2.2:3000` | Points to host machine loopback |
| **iOS Simulator** | `http://localhost:3000` | Direct localhost loopback |
| **Physical Test Device** | `http://<HOST_LAN_IP>:3000` | Ensure firewall permits port 3000 |
| **Production Cloud** | `https://api.bwallet.dev` | TLS 1.3 enforced |

```dart
class AppConfig {
  static const String devAndroidUrl = 'http://10.0.2.2:3000';
  static const String devIosUrl = 'http://localhost:3000';
  static const String prodUrl = 'https://api.bwallet.dev';

  static String get baseUrl {
    if (const bool.fromEnvironment('dart.vm.product')) {
      return prodUrl;
    }
    return Platform.isAndroid ? devAndroidUrl : devIosUrl;
  }

  static const String supabaseUrl = 'https://uusfffnhimwrcwtucbck.supabase.co';
  static const String supabaseAnonKey = 'YOUR_SUPABASE_ANON_KEY';
}
```

---

## 2. Networking Architecture (Dio + Interceptors)

### 2.1 Dio Client Singleton with Interceptors
The mobile app communicates via a centralized `ApiClient` configured with:
1. **AuthInterceptor**: Injects `Authorization: Bearer <token>` and performs transparent JWT refresh upon receiving HTTP 401.
2. **IdempotencyInterceptor**: Automatically attaches a unique UUIDv4 `X-Idempotency-Key` for state-mutating requests (`POST`, `PATCH`, `DELETE`). The backend enforces idempotency validation on **financial mutation endpoints only** (`POST /transfers` and `POST /requests/:id/pay`); attaching the header preemptively for all mutating calls is safe and has no effect on non-enforcing routes.
3. **ErrorInterceptor**: Normalizes backend error envelopes into strongly typed `ApiException` instances.

```dart
import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

class ApiClient {
  static final ApiClient _instance = ApiClient._internal();
  factory ApiClient() => _instance;

  late final Dio dio;
  final FlutterSecureStorage _storage = const FlutterSecureStorage();
  final Uuid _uuid = const Uuid();

  ApiClient._internal() {
    dio = Dio(
      BaseOptions(
        baseUrl: AppConfig.baseUrl,
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 15),
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      ),
    );

    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          // 1. Attach Access Token
          final token = await _storage.read(key: 'accessToken');
          if (token != null && token.isNotEmpty) {
            options.headers['Authorization'] = 'Bearer $token';
          }

          // 2. Attach Idempotency Key for Mutating Calls
          if (['POST', 'PATCH', 'DELETE'].contains(options.method.toUpperCase())) {
            if (!options.headers.containsKey('X-Idempotency-Key')) {
              options.headers['X-Idempotency-Key'] = _uuid.v4();
            }
          }

          return handler.next(options);
        },
        onError: (DioException error, handler) async {
          // 3. Transparent 401 Token Refresh
          if (error.response?.statusCode == 401 &&
              !error.requestOptions.path.contains('/auth/login') &&
              !error.requestOptions.path.contains('/auth/refresh')) {
            final refreshed = await _handleTokenRefresh();
            if (refreshed) {
              final newAccessToken = await _storage.read(key: 'accessToken');
              error.requestOptions.headers['Authorization'] = 'Bearer $newAccessToken';
              try {
                final cloneReq = await dio.fetch(error.requestOptions);
                return handler.resolve(cloneReq);
              } catch (e) {
                return handler.next(error);
              }
            }
          }
          return handler.next(error);
        },
      ),
    );
  }

  Future<bool> _handleTokenRefresh() async {
    final refreshToken = await _storage.read(key: 'refreshToken');
    if (refreshToken == null) return false;

    try {
      final refreshDio = Dio(BaseOptions(baseUrl: AppConfig.baseUrl));
      final response = await refreshDio.post('/api/v1/auth/refresh', data: {
        'refreshToken': refreshToken,
      });

      if (response.statusCode == 200 && response.data['success'] == true) {
        final newAccess = response.data['data']['accessToken'];
        final newRefresh = response.data['data']['refreshToken'] ?? refreshToken;
        await _storage.write(key: 'accessToken', value: newAccess);
        await _storage.write(key: 'refreshToken', value: newRefresh);
        return true;
      }
    } catch (_) {
      await _storage.deleteAll();
    }
    return false;
  }
}
```

---

## 3. Data Models (Dart)

### 3.1 Wallet Model
```dart
class WalletModel {
  final String id;
  final String currency;
  final double balance;
  final String status;

  WalletModel({
    required this.id,
    required this.currency,
    required this.balance,
    required this.status,
  });

  factory WalletModel.fromJson(Map<String, dynamic> json) {
    return WalletModel(
      id: json['id'] ?? '',
      currency: json['currency'] ?? 'USD',
      balance: double.tryParse(json['balance']?.toString() ?? '0.00') ?? 0.0,
      status: json['status'] ?? 'ACTIVE',
    );
  }
}
```

### 3.2 Transaction Receipt Model
```dart
class TransactionModel {
  final String id;
  final String reference;
  final String type;
  final double amount;
  final double fee;
  final String currency;
  final String status;
  final String category;
  final String? note;
  final DateTime createdAt;
  final String? counterpartyName;
  final String? counterpartyPhone;

  TransactionModel({
    required this.id,
    required this.reference,
    required this.type,
    required this.amount,
    required this.fee,
    required this.currency,
    required this.status,
    required this.category,
    this.note,
    required this.createdAt,
    this.counterpartyName,
    this.counterpartyPhone,
  });

  factory TransactionModel.fromJson(Map<String, dynamic> json) {
    return TransactionModel(
      id: json['id'] ?? '',
      reference: json['reference'] ?? json['transaction_reference'] ?? '',
      type: json['type'] ?? 'TRANSFER',
      amount: double.tryParse(json['amount']?.toString() ?? '0.00') ?? 0.0,
      fee: double.tryParse(json['fee']?.toString() ?? '0.00') ?? 0.0,
      currency: json['currency'] ?? 'USD',
      status: json['status'] ?? 'COMPLETED',
      category: json['category'] ?? 'Expense',
      note: json['note'],
      createdAt: DateTime.tryParse(json['created_at'] ?? json['createdAt'] ?? '') ?? DateTime.now(),
      counterpartyName: json['counterparty']?['fullName'],
      counterpartyPhone: json['counterparty']?['phoneNumber'],
    );
  }
}
```

### 3.3 Cash Flow Analytics Model
```dart
class CashFlowSummary {
  final double totalIncome;
  final double totalExpense;
  final double netSavings;
  final double netSavingsRatio;

  CashFlowSummary({
    required this.totalIncome,
    required this.totalExpense,
    required this.netSavings,
    required this.netSavingsRatio,
  });

  factory CashFlowSummary.fromJson(Map<String, dynamic> json) {
    return CashFlowSummary(
      totalIncome: double.tryParse(json['total_income']?.toString() ?? '0.0') ?? 0.0,
      totalExpense: double.tryParse(json['total_expense']?.toString() ?? '0.0') ?? 0.0,
      netSavings: double.tryParse(json['net_savings']?.toString() ?? '0.0') ?? 0.0,
      netSavingsRatio: double.tryParse(json['net_savings_ratio']?.toString() ?? '0.0') ?? 0.0,
    );
  }
}

class CategoryExpense {
  final String category;
  final double totalAmount;
  final double percentage;
  final int transactionCount;

  CategoryExpense({
    required this.category,
    required this.totalAmount,
    required this.percentage,
    required this.transactionCount,
  });

  factory CategoryExpense.fromJson(Map<String, dynamic> json) {
    return CategoryExpense(
      category: json['category'] ?? 'Other',
      totalAmount: double.tryParse(json['total_amount']?.toString() ?? '0.0') ?? 0.0,
      percentage: double.tryParse(json['percentage']?.toString() ?? '0.0') ?? 0.0,
      transactionCount: json['transaction_count'] ?? 0,
    );
  }
}
```

---

## 4. GetX Controllers

### 4.1 WalletController
```dart
import 'package:get/get.dart';

class WalletController extends GetxController {
  final ApiClient _api = ApiClient();

  var isLoading = false.obs;
  var wallet = Rxn<WalletModel>();
  var transactions = <TransactionModel>[].obs;
  var dailyLimit = 5000.0.obs;
  var spentToday = 0.0.obs;

  @override
  void onInit() {
    super.onInit();
    fetchWallet();
    fetchTransactions();
  }

  Future<void> fetchWallet() async {
    try {
      isLoading.value = true;
      final res = await _api.dio.get('/api/v1/wallets');
      if (res.data['success'] == true) {
        wallet.value = WalletModel.fromJson(res.data['data']['wallet']);
        spentToday.value = double.tryParse(res.data['data']['limits']['spentToday'] ?? '0.0') ?? 0.0;
      }
    } catch (e) {
      Get.snackbar('Error', 'Failed to load wallet data');
    } finally {
      isLoading.value = false;
    }
  }

  Future<void> fetchTransactions() async {
    try {
      final res = await _api.dio.get('/api/v1/wallets/transactions?limit=20');
      if (res.data['success'] == true) {
        final list = (res.data['data']['transactions'] as List)
            .map((e) => TransactionModel.fromJson(e))
            .toList();
        transactions.assignAll(list);
      }
    } catch (_) {}
  }
}
```

### 4.2 TransferController & PIN Flow
```dart
import 'package:get/get.dart';
import 'package:uuid/uuid.dart';

class TransferController extends GetxController {
  final ApiClient _api = ApiClient();
  var isSubmitting = false.obs;
  var remainingPinAttempts = 3.obs;
  var isPinLocked = false.obs;

  /// Executes P2P Transfer with verified PIN or Short-Lived Ticket
  Future<bool> executeTransfer({
    required String receiverPhone,
    required double amount,
    required String category,
    required String pin,
    String? note,
  }) async {
    try {
      isSubmitting.value = true;
      final response = await _api.dio.post(
        '/api/v1/transfers',
        options: Options(headers: {'X-Idempotency-Key': const Uuid().v4()}),
        data: {
          'receiver_phone': receiverPhone,
          'amount': amount,
          'category': category,
          'note': note,
          'pin': pin,
        },
      );

      if (response.statusCode == 201 && response.data['success'] == true) {
        // Refresh wallet balance
        Get.find<WalletController>().fetchWallet();
        Get.snackbar('Transfer Successful', 'Sent \$$amount to $receiverPhone');
        return true;
      }
    } on DioException catch (e) {
      final code = e.response?.data?['error']?['code'];
      if (code == 'INCORRECT_PIN') {
        remainingPinAttempts.value = e.response?.data?['error']?['details']?['remainingAttempts'] ?? 2;
        Get.snackbar('Incorrect PIN', 'Remaining attempts: ${remainingPinAttempts.value}');
      } else if (code == 'PIN_LOCKED') {
        isPinLocked.value = true;
        Get.snackbar('Account Locked', 'PIN locked for 15 minutes due to consecutive failed attempts.');
      } else {
        Get.snackbar('Transfer Failed', e.response?.data?['error']?['message'] ?? 'Unknown error');
      }
    } finally {
      isSubmitting.value = false;
    }
    return false;
  }
}
```

---

## 5. Supabase Realtime Integration

Realtime enables instantaneous UI updates without pulling or polling.

```dart
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:get/get.dart';

class RealtimeService extends GetxService {
  late final SupabaseClient _supabase;

  Future<RealtimeService> init(String userJwt) async {
    _supabase = SupabaseClient(
      AppConfig.supabaseUrl,
      AppConfig.supabaseAnonKey,
      headers: {'Authorization': 'Bearer $userJwt'},
    );
    return this;
  }

  void subscribeToUserWallet(String walletId) {
    _supabase
        .channel('wallet-realtime:$walletId')
        .onPostgresChanges(
          event: PostgresChangeEvent.update,
          schema: 'public',
          table: 'wallets',
          filter: PostgresChangeFilter(
            type: PostgresChangeFilterType.eq,
            column: 'id',
            value: walletId,
          ),
          callback: (payload) {
            // Live wallet balance update
            Get.find<WalletController>().fetchWallet();
          },
        )
        .subscribe();
  }

  void subscribeToNotifications(String userId) {
    _supabase
        .channel('notifications-realtime:$userId')
        .onPostgresChanges(
          event: PostgresChangeEvent.insert,
          schema: 'public',
          table: 'notifications',
          filter: PostgresChangeFilter(
            type: PostgresChangeFilterType.eq,
            column: 'user_id',
            value: userId,
          ),
          callback: (payload) {
            Get.snackbar(
              payload.newRecord['title'] ?? 'New Notification',
              payload.newRecord['body'] ?? '',
              snackPosition: SnackPosition.TOP,
            );
          },
        )
        .subscribe();
  }

  void subscribeToChat(String conversationId) {
    _supabase
        .channel('chat-realtime:$conversationId')
        .onPostgresChanges(
          event: PostgresChangeEvent.insert,
          schema: 'public',
          table: 'messages',
          filter: PostgresChangeFilter(
            type: PostgresChangeFilterType.eq,
            column: 'conversation_id',
            value: conversationId,
          ),
          callback: (payload) {
            // Handle incoming message card
          },
        )
        .subscribe();
  }
}
```

---

## 6. Security & Transaction PIN UX Best Practices

1. **Never Cache Plaintext PIN**: The 6-digit PIN should never be stored in persistent memory or local storage.
2. **5-Minute Transaction Ticket Option**:
   - For multi-step checkout flows, call `POST /api/v1/auth/pin/verify` once to receive a signed `ticket`.
   - Pass `"ticket": "<ticket>"` in the subsequent transfer/pay calls within 300 seconds.
3. **Lockout Handling (HTTP 423)**:
   - When the backend responds with HTTP 423 (`PIN_LOCKED`), disable all PIN keypad entries on the UI.
   - Start a 15-minute visual countdown timer using the returned `lockedUntil` ISO timestamp.
4. **Idempotency Safeguard**:
   - Every tap of a "Send" or "Pay" button must generate a single UUIDv4 key.
   - Even in cases of network timeouts or repeated taps, the backend enforces exactly-once execution on financial endpoints (`POST /transfers`, `POST /requests/:id/pay`), returning the original cached response for any replay of a seen key.

