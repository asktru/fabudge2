<?php

namespace App\Models;

use Database\Factories\BudgetFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * @property string $id
 * @property int $team_id
 * @property string $name
 * @property string $currency
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Team $team
 */
#[Fillable(['team_id', 'name', 'currency'])]
class Budget extends Model
{
    /** @use HasFactory<BudgetFactory> */
    use HasFactory, HasUuids;

    /**
     * Get the budget for a team, creating it on first access.
     */
    public static function forTeam(Team $team): Budget
    {
        return static::firstOrCreate(
            ['team_id' => $team->id],
            ['name' => $team->name, 'currency' => 'CAD'],
        );
    }

    /**
     * @return BelongsTo<Team, $this>
     */
    public function team(): BelongsTo
    {
        return $this->belongsTo(Team::class);
    }
}
