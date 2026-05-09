import sys
sys.path.insert(0, '.')
import renderer

def make_stats(cats_str):
    """Convert 'PTS 28.5 · REB 13.2 · AST 10.1' into list of {label, value} dicts."""
    parts = [p.strip() for p in cats_str.split('·')]
    result = []
    for part in parts:
        bits = part.split()
        if len(bits) == 2:
            result.append({'label': bits[0], 'value': bits[1]})
    return result

players = [
    {'name': 'Nikola Jokic',            'team': 'DEN', 'games': 5, 'stats': make_stats('PTS 28.5 · REB 13.2 · AST 10.1')},
    {'name': 'Shai Gilgeous-Alexander', 'team': 'OKC', 'games': 4, 'stats': make_stats('PTS 32.1 · AST 6.2 · STL 2.1')},
    {'name': 'Anthony Davis',           'team': 'LAL', 'games': 5, 'stats': make_stats('PTS 27.4 · REB 12.5 · BLK 2.3')},
    {'name': 'Tyrese Haliburton',       'team': 'IND', 'games': 4, 'stats': make_stats('AST 10.8 · PTS 20.1 · STL 1.8')},
    {'name': 'Jaren Jackson Jr.',       'team': 'MEM', 'games': 5, 'stats': make_stats('BLK 3.2 · PTS 22.1 · REB 6.8')},
    {'name': 'Jayson Tatum',            'team': 'BOS', 'games': 4, 'stats': make_stats('PTS 27.0 · REB 8.1 · AST 4.5')},
    {'name': 'Domantas Sabonis',        'team': 'SAC', 'games': 5, 'stats': make_stats('REB 13.8 · PTS 19.5 · AST 7.2')},
    {'name': 'Bam Adebayo',             'team': 'MIA', 'games': 4, 'stats': make_stats('PTS 21.2 · REB 10.4 · BLK 1.2')},
    {'name': 'LaMelo Ball',             'team': 'CHA', 'games': 5, 'stats': make_stats('PTS 23.5 · AST 8.1 · STL 1.6')},
    {'name': 'Cade Cunningham',         'team': 'DET', 'games': 4, 'stats': make_stats('PTS 24.3 · AST 6.8 · REB 4.5')},
]

path = renderer.render_and_screenshot('weekly_performers.html', {
    'date_range': 'MAY 12-19',
    'players': players,
}, 'preview_weekly_v4', format='square')

print('Saved to:', path)
