<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('budgets', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignId('team_id')->unique()->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->char('currency', 3)->default('CAD');
            $table->timestamps();
        });

        $syncable = function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('budget_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('updated_at_ms');
            $table->unsignedBigInteger('deleted_at_ms')->nullable();
            $table->unsignedBigInteger('server_seq');
            $table->index(['budget_id', 'server_seq']);
        };

        Schema::create('accounts', function (Blueprint $table) use ($syncable) {
            $syncable($table);
            $table->string('name');
            $table->char('currency', 3);
            $table->string('type');
            $table->boolean('on_budget')->default(true);
            $table->text('note')->nullable();
            $table->integer('sort_order')->default(0);
        });

        Schema::create('category_groups', function (Blueprint $table) use ($syncable) {
            $syncable($table);
            $table->string('name');
            $table->integer('sort_order')->default(0);
        });

        Schema::create('categories', function (Blueprint $table) use ($syncable) {
            $syncable($table);
            $table->uuid('category_group_id')->nullable()->index();
            $table->string('name');
            $table->integer('sort_order')->default(0);
        });

        Schema::create('payees', function (Blueprint $table) use ($syncable) {
            $syncable($table);
            $table->string('name');
        });

        Schema::create('transactions', function (Blueprint $table) use ($syncable) {
            $syncable($table);
            $table->uuid('account_id')->index();
            $table->date('date');
            $table->bigInteger('amount');
            $table->uuid('payee_id')->nullable()->index();
            $table->uuid('category_id')->nullable()->index();
            $table->text('memo')->nullable();
            $table->string('cleared')->default('uncleared');
            $table->uuid('transfer_pair_id')->nullable()->index();
        });

        Schema::create('exchange_rates', function (Blueprint $table) {
            $table->id();
            $table->char('quote_currency', 3)->unique();
            $table->decimal('rate', 18, 8);
            $table->timestamp('fetched_at');
        });

        Schema::create('sync_sequence', function (Blueprint $table) {
            $table->unsignedTinyInteger('id')->primary();
            $table->unsignedBigInteger('value');
        });

        DB::table('sync_sequence')->insert(['id' => 1, 'value' => 0]);
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('sync_sequence');
        Schema::dropIfExists('exchange_rates');
        Schema::dropIfExists('transactions');
        Schema::dropIfExists('payees');
        Schema::dropIfExists('categories');
        Schema::dropIfExists('category_groups');
        Schema::dropIfExists('accounts');
        Schema::dropIfExists('budgets');
    }
};
