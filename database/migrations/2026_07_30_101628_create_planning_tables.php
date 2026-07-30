<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        $syncable = function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('budget_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('updated_at_ms');
            $table->unsignedBigInteger('deleted_at_ms')->nullable();
            $table->unsignedBigInteger('server_seq');
            $table->index(['budget_id', 'server_seq']);
        };

        Schema::create('assignments', function (Blueprint $table) use ($syncable) {
            $syncable($table);
            $table->uuid('category_id')->index();
            $table->char('month', 7);
            $table->bigInteger('amount');
            $table->index(['category_id', 'month']);
        });

        Schema::create('targets', function (Blueprint $table) use ($syncable) {
            $syncable($table);
            $table->uuid('category_id')->index();
            $table->string('type');
            $table->bigInteger('amount');
            $table->char('due_month', 7)->nullable();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('targets');
        Schema::dropIfExists('assignments');
    }
};
